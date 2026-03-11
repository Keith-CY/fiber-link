import {
  compareDecimalStrings,
  createDbClient,
  createDbLedgerRepo,
  createDbLiquidityRequestRepo,
  createDbWithdrawalPolicyRepo,
  createDbWithdrawalRepo,
  type CreateWithdrawalInput,
  type LedgerRepo,
  type LiquidityRequestRepo,
  type WithdrawalPolicyRepo,
  type WithdrawalRepo,
} from "@fiber-link/db";
import {
  createDefaultHotWalletInventoryProvider,
  type HotWalletInventoryProvider,
  resolveCkbNetworkConfig,
  type WithdrawalDestination,
} from "@fiber-link/fiber-adapter";
import { MissingLiquidityRequestRepoError, decideWithdrawalRequestLiquidity } from "./liquidity";
import {
  assertOnChainWithdrawalReady,
  assertWithdrawalPolicy,
  defaultPolicyForApp,
  resolveMinimumRequiredAmount,
  usageFallback,
  WithdrawalPolicyViolationError,
  type RequestWithdrawalInput,
} from "./withdrawal-policy";
import {
  assertSufficientCreatorBalance,
  computeReceiveAmount,
  computeSpendableBalance,
  estimateNetworkFee,
} from "./withdrawal-balance";

export { WithdrawalPolicyViolationError, type RequestWithdrawalInput } from "./withdrawal-policy";

export type RequestWithdrawalOptions = {
  repo?: WithdrawalRepo;
  ledgerRepo?: LedgerRepo;
  policyRepo?: WithdrawalPolicyRepo | null;
  liquidityRequestRepo?: LiquidityRequestRepo | null;
  hotWalletInventoryProvider?: HotWalletInventoryProvider | null;
  now?: Date;
};

let defaultRepo: WithdrawalRepo | null = null;
let defaultLedgerRepo: LedgerRepo | null = null;
let defaultLiquidityRequestRepo: LiquidityRequestRepo | null | undefined;
let defaultPolicyRepo: WithdrawalPolicyRepo | null | undefined;
let defaultHotWalletInventoryProvider: HotWalletInventoryProvider | null | undefined;
const hotWalletReservationLocks = new Map<string, Promise<void>>();

function getDefaultRepo(): WithdrawalRepo {
  if (!defaultRepo) {
    defaultRepo = createDbWithdrawalRepo(createDbClient());
  }
  return defaultRepo;
}

function getDefaultLedgerRepo(): LedgerRepo {
  if (!defaultLedgerRepo) {
    defaultLedgerRepo = createDbLedgerRepo(createDbClient());
  }
  return defaultLedgerRepo;
}

function getDefaultPolicyRepo(): WithdrawalPolicyRepo | null {
  if (defaultPolicyRepo !== undefined) {
    return defaultPolicyRepo;
  }
  try {
    defaultPolicyRepo = createDbWithdrawalPolicyRepo(createDbClient());
  } catch {
    defaultPolicyRepo = null;
  }
  return defaultPolicyRepo;
}

function getDefaultLiquidityRequestRepo(): LiquidityRequestRepo | null {
  if (defaultLiquidityRequestRepo !== undefined) {
    return defaultLiquidityRequestRepo;
  }
  try {
    defaultLiquidityRequestRepo = createDbLiquidityRequestRepo(createDbClient());
  } catch {
    defaultLiquidityRequestRepo = null;
  }
  return defaultLiquidityRequestRepo;
}

function getDefaultHotWalletInventoryProvider(): HotWalletInventoryProvider | null {
  if (defaultHotWalletInventoryProvider !== undefined) {
    return defaultHotWalletInventoryProvider;
  }
  if (!process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY?.trim()) {
    defaultHotWalletInventoryProvider = null;
    return defaultHotWalletInventoryProvider;
  }
  defaultHotWalletInventoryProvider = createDefaultHotWalletInventoryProvider();
  return defaultHotWalletInventoryProvider;
}

async function withHotWalletReservationLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = hotWalletReservationLocks.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.then(() => current, () => current);
  hotWalletReservationLocks.set(key, tail);

  await previous;
  try {
    return await work();
  } finally {
    releaseCurrent();
    if (hotWalletReservationLocks.get(key) === tail) {
      hotWalletReservationLocks.delete(key);
    }
  }
}

function mapDestinationForStorage(destination: WithdrawalDestination): Pick<CreateWithdrawalInput, "toAddress" | "destinationKind"> {
  if (destination.kind === "CKB_ADDRESS") {
    return {
      toAddress: destination.address,
      destinationKind: "CKB_ADDRESS",
    };
  }

  return {
    toAddress: destination.paymentRequest,
    destinationKind: "PAYMENT_REQUEST",
  };
}

function getHotWalletReservationKey(input: RequestWithdrawalInput): string | null {
  if (input.destination.kind !== "CKB_ADDRESS") {
    return null;
  }

  try {
    const { isTestnet } = resolveCkbNetworkConfig(input.destination.address);
    const network = isTestnet ? "AGGRON4" : "LINA";
    return `${input.appId}:${input.asset}:${network}`;
  } catch {
    return null;
  }
}

export async function quoteWithdrawal(
  input: RequestWithdrawalInput,
  options: Pick<RequestWithdrawalOptions, "repo" | "ledgerRepo"> = {},
) {
  const repo = options.repo ?? getDefaultRepo();
  const ledgerRepo = options.ledgerRepo ?? getDefaultLedgerRepo();
  const [availableBalance, lockedBalance] = await Promise.all([
    ledgerRepo.getBalance({
      appId: input.appId,
      userId: input.userId,
      asset: input.asset,
    }),
    repo.getPendingTotal({
      appId: input.appId,
      userId: input.userId,
      asset: input.asset,
    }),
  ]);

  let minimumAmount = "0";
  let destinationValid = true;
  let validationMessage: string | null = null;

  try {
    minimumAmount = await resolveMinimumRequiredAmount(input);
  } catch (error) {
    if (error instanceof WithdrawalPolicyViolationError) {
      destinationValid = false;
      validationMessage = error.message;
    } else {
      throw error;
    }
  }

  const networkFee = estimateNetworkFee(input);
  const receiveAmount = computeReceiveAmount(input.amount, networkFee);
  const spendableBalance = computeSpendableBalance(availableBalance, lockedBalance);

  if (destinationValid && compareDecimalStrings(input.amount, minimumAmount) < 0) {
    validationMessage = `Minimum withdrawal is ${minimumAmount} ${input.asset}.`;
  } else if (destinationValid && compareDecimalStrings(input.amount, spendableBalance) > 0) {
    validationMessage = "Amount exceeds your available balance.";
  } else if (destinationValid && compareDecimalStrings(receiveAmount, "0") <= 0) {
    validationMessage = "Amount must be greater than the estimated network fee.";
  }

  return {
    asset: input.asset,
    amount: input.amount,
    minimumAmount,
    availableBalance,
    lockedBalance,
    networkFee,
    receiveAmount,
    destinationValid,
    validationMessage,
  };
}

export async function requestWithdrawal(input: RequestWithdrawalInput, options: RequestWithdrawalOptions = {}) {
  const now = options.now ?? new Date();
  const repo = options.repo ?? getDefaultRepo();
  const ledgerRepo = options.ledgerRepo ?? getDefaultLedgerRepo();
  const policyRepo = options.policyRepo === undefined ? getDefaultPolicyRepo() : options.policyRepo;

  const policy = (policyRepo ? await policyRepo.getByAppId(input.appId) : null) ?? defaultPolicyForApp(input.appId);
  const usage = policyRepo
    ? await policyRepo.getUsage({
        appId: input.appId,
        userId: input.userId,
        asset: input.asset,
        now,
      })
    : usageFallback();

  const minimumRequiredAmount = await resolveMinimumRequiredAmount(input);
  assertWithdrawalPolicy(input, policy, usage, now, minimumRequiredAmount);
  await assertSufficientCreatorBalance(input, { repo, ledgerRepo });

  const createInput: CreateWithdrawalInput = {
    appId: input.appId,
    userId: input.userId,
    asset: input.asset,
    amount: input.amount,
    ...mapDestinationForStorage(input.destination),
  };

  const hotWalletInventoryProvider =
    options.hotWalletInventoryProvider === undefined
      ? input.destination.kind === "CKB_ADDRESS"
        ? getDefaultHotWalletInventoryProvider()
        : null
      : options.hotWalletInventoryProvider;
  assertOnChainWithdrawalReady(input, options.hotWalletInventoryProvider === undefined);
  const runCreate = async () => {
    let liquidityDecision;
    try {
      liquidityDecision = await decideWithdrawalRequestLiquidity(input, {
        repo,
        hotWalletInventoryProvider,
        liquidityRequestRepo: options.liquidityRequestRepo,
      });
    } catch (error) {
      if (
        error instanceof MissingLiquidityRequestRepoError &&
        input.destination.kind === "CKB_ADDRESS" &&
        options.liquidityRequestRepo === undefined
      ) {
        liquidityDecision = await decideWithdrawalRequestLiquidity(input, {
          repo,
          hotWalletInventoryProvider,
          liquidityRequestRepo: getDefaultLiquidityRequestRepo(),
        });
      } else {
        throw error;
      }
    }

    if (liquidityDecision.state === "LIQUIDITY_PENDING") {
      const record = await repo.createLiquidityPendingWithBalanceCheck({
        ...createInput,
        liquidityRequestId: liquidityDecision.liquidityRequestId,
        liquidityPendingReason: liquidityDecision.liquidityPendingReason,
      }, { ledgerRepo });
      return { id: record.id, state: record.state };
    }

    const record = await repo.createWithBalanceCheck(
      createInput,
      { ledgerRepo },
    );
    return { id: record.id, state: record.state };
  };

  const hotWalletReservationKey = getHotWalletReservationKey(input);
  if (!hotWalletReservationKey || !hotWalletInventoryProvider) {
    return runCreate();
  }

  return withHotWalletReservationLock(hotWalletReservationKey, runCreate);
}

export function __setRequestWithdrawalDefaultsForTests(defaults: RequestWithdrawalOptions) {
  defaultRepo = defaults.repo ?? null;
  defaultLedgerRepo = defaults.ledgerRepo ?? null;
  defaultPolicyRepo = defaults.policyRepo ?? null;
  defaultLiquidityRequestRepo = defaults.liquidityRequestRepo ?? null;
  defaultHotWalletInventoryProvider = defaults.hotWalletInventoryProvider ?? null;
}

export function __resetRequestWithdrawalDefaultsForTests() {
  defaultRepo = null;
  defaultLedgerRepo = null;
  defaultPolicyRepo = undefined;
  defaultLiquidityRequestRepo = undefined;
  defaultHotWalletInventoryProvider = undefined;
}
