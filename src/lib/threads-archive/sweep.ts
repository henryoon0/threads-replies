import { readJob } from "./storage";
import { runSync } from "./sync";
import { isActiveState } from "./model";
import { registerSweepAdapter, type ActiveJobRef, type ListResumeSweepAdapter } from "@/lib/jobs/sweep";

/** 잡이 하나뿐인 도메인이라 id 는 고정값. */
const JOB_ID = "threads-archive";

export const threadsArchiveSweepAdapter: ListResumeSweepAdapter = {
  name: "threads-archive",
  async listActive(): Promise<ActiveJobRef[]> {
    const job = await readJob();
    if (!isActiveState(job.state)) return [];
    return [{ id: JOB_ID, updatedAt: job.updatedAt }];
  },
  resume() {
    void runSync();
  },
};

export function registerThreadsArchiveSweep(): void {
  registerSweepAdapter(threadsArchiveSweepAdapter);
}
