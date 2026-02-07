import {
  createDbClient,
  createDbWithdrawalRepo,
  type CreateWithdrawalInput,
  type WithdrawalRepo,
} from "@fiber-link/db";

export type RequestWithdrawalInput = CreateWithdrawalInput;

type RequestWithdrawalOptions = {
  repo?: WithdrawalRepo;
};

let defaultRepo: WithdrawalRepo | null = null;

function getDefaultRepo(): WithdrawalRepo {
  if (!defaultRepo) {
    defaultRepo = createDbWithdrawalRepo(createDbClient());
  }
  return defaultRepo;
}

export async function requestWithdrawal(input: RequestWithdrawalInput, options: RequestWithdrawalOptions = {}) {
  const repo = options.repo ?? getDefaultRepo();
  const record = await repo.create(input);
  return { id: record.id, state: record.state };
}
