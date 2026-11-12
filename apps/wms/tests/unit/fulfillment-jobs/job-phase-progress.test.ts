import { describe, expect, it } from "vitest";
import { phaseProgress } from "@/server/repositories/jobs-progress";

describe("phaseProgress", () => {
  it("splits picking and packing so picked units do not hide pending packing tasks", () => {
    const res = phaseProgress([
      { taskType: "Packing", status: "Pending", plannedQty: 1, actualQty: 0 },
      { taskType: "Picking", status: "Completed", plannedQty: 1, actualQty: 1 },
      { taskType: "Picking", status: "Completed", plannedQty: 1, actualQty: 1 },
      { taskType: "Packing", status: "Started", plannedQty: 1, actualQty: 0 },
    ]);
    expect(res.map((p) => p.phase)).toEqual(["Picking", "Packing"]);
    expect(res[0]).toMatchObject({ taskCount: 2, completedTasks: 2, pendingTasks: 0, plannedUnits: 2, actualUnits: 2 });
    expect(res[1]).toMatchObject({ taskCount: 2, completedTasks: 0, pendingTasks: 1, startedTasks: 1, actualUnits: 0 });
  });

  it("ignores cancelled tasks and returns [] for no tasks", () => {
    expect(phaseProgress([])).toEqual([]);
    expect(phaseProgress([{ taskType: "Count", status: "Cancelled", plannedQty: 3, actualQty: 0 }])).toEqual([]);
  });
});
