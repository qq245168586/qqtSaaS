import type { Resource } from './contracts';

export function normalizedDepartmentName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .replace(/(?:部门|部|组)$/u, '');
}

export function matchingBusinessEmployees(
  departments: readonly Resource[],
  employees: readonly Resource[],
  departmentId: string | null | undefined,
  documentDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
): Resource[] {
  if (!departmentId) return [];
  const department = departments.find((item) => item.id === departmentId);
  const business = normalizedDepartmentName(department?.name);
  return employees.filter((employee) => {
    if (!employeeAvailableOn(employee, documentDate)) return false;
    const employeeDepartment = departments.find((item) => item.id === employee.department_id);
    return business
      ? normalizedDepartmentName(employeeDepartment?.name) === business
      : employee.department_id === departmentId;
  });
}

export function employeeAvailableOn(employee: Resource, date: string): boolean {
  return employee.left_on
    ? date.slice(0, 10) < employee.left_on.slice(0, 10)
    : employee.status !== 'left';
}
