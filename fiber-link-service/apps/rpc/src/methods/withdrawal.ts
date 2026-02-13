import {
  createDbClient,
  createDbLedgerRepo,
  createDbWithdrawalRepo,
  type CreateWithdrawalInput,
  type LedgerRepo,
  type WithdrawalRepo,
} from "@fiber-link/db";

export type RequestWithdrawalInput = CreateWithdrawalInput;

type RequestWithdrawalOptions = {
  repo?: WithdrawalRepo;
  ledgerRepo?: LedgerRepo;
};

let defaultRepo: WithdrawalRepo | null = null;
let defaultLedgerRepo: LedgerRepo | null = null;

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

export async function requestWithdrawal(input: RequestWithdrawalInput, options: RequestWithdrawalOptions = {}) {
  const repo = options.repo ?? getDefaultRepo();
  const ledgerRepo = options.ledgerRepo ?? getDefaultLedgerRepo();
  const record = await repo.createWithBalanceCheck(input, { ledgerRepo });
  return { id: record.id, state: record.state };
}
