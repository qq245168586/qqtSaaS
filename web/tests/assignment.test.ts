import { describe, expect, it } from "vitest";
import {
  matchingBusinessEmployees,
  normalizedDepartmentName,
} from "../src/assignment";

const departments = [
  { id: "1", name: "蛋糕部", company_code: "tri" as const },
  { id: "2", name: "蛋糕部门", company_code: "tmy" as const },
  { id: "3", name: "制面部", company_code: "tmy" as const },
];
const employees = [
  {
    id: "11",
    name: "趣趣特蛋糕员工",
    department_id: "1",
    status: "active" as const,
  },
  {
    id: "12",
    name: "天美意蛋糕员工",
    department_id: "2",
    status: "active" as const,
  },
  {
    id: "13",
    name: "离职员工",
    department_id: "1",
    status: "left" as const,
  },
];

describe("网页任务执行人匹配", () => {
  it("员工没有公司属性，同业务部门共享执行人", () => {
    expect(normalizedDepartmentName(" 蛋糕部门 ")).toBe("蛋糕");
    expect(
      matchingBusinessEmployees(departments, employees, "1").map(
        (item) => item.id,
      ),
    ).toEqual(["11", "12"]);
  });

  it("不同公司同名业务部门使用同一员工池", () => {
    expect(
      matchingBusinessEmployees(departments, employees, "2").map(
        (item) => item.id,
      ),
    ).toEqual(["11", "12"]);
  });
});
