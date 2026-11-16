const allowedApiPath =
  /^\/(health|company-suggestions|assignee-suggestions|companies|tasks|todos|delivery-notes|delivery-summary|departments|employees|employee-schedules|categories|customers|customer-categories|products|personnel|print-templates|ai|users|backup|auth\/change-password|bom|boms|kingdee-products|wiki|cost)(\/|\?|$)/;

export function isAllowedApiPath(path: string): boolean {
  return allowedApiPath.test(path) && !path.includes('..') && !path.includes('\\');
}
