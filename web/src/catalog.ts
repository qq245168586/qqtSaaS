import { request } from "./api";
import { pageSchema, resourceSchema, type Resource } from "./models";
export interface Catalog {
  companies?: Resource[];
  departments: Resource[];
  employees: Resource[];
  categories: Resource[];
}
/** All pages are necessary for selectors, including employees beyond the first 100. */
export async function allResources(kind: keyof Catalog): Promise<Resource[]> {
  let page = 1;
  const result: Resource[] = [];
  while (true) {
    const data = await request(
      `/${kind}?page=${page}&page_size=100`,
      pageSchema(resourceSchema),
    );
    result.push(...data.items);
    if (result.length >= data.total) return result;
    if (!data.items.length)
      throw new Error("基础资料分页数据不完整，请刷新重试");
    page++;
  }
}
