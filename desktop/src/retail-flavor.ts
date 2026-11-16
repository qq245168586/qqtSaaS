/** Conservative display-only extraction from saved order text. Unknown flavors stay empty. */
export function retailFlavor(order: {
  product_summary?: string | null;
  title?: string | null;
  content?: string | null;
  source_text?: string | null;
  note?: string | null;
}): string {
  const text = [order.product_summary, order.title, order.content, order.note, order.source_text]
    .filter(Boolean)
    .join('\n')
    // Names and addresses can contain ingredient names; they are not product evidence.
    .replace(
      /(?:配送地址|送达地址|收货地址|地址|地点|收货人|联系人|客户|电话|接单人)\s*[:：][^\n；;]*/gu,
      '',
    )
    .replace(/(?:不要|不加|不含|去掉|去除|无)(?:任何)?[^\n，,；;。]*/gu, '');
  // Longest/specific expressions first: consume them before matching shorter flavors.
  const flavors = [
    ['薄荷柑橘', /薄荷\s*柑橘/gu],
    ['薄荷生巧', /薄荷\s*生巧/gu],
    ['鲜水果夹心', /(?:新鲜水果|鲜水果|水果)\s*夹[心馅]/gu],
    ['伯爵红茶', /伯爵\s*红茶/gu],
    ['海盐芝士', /海盐\s*芝士/gu],
    ['泰奶', /泰奶/gu],
    ['焙茶', /焙茶/gu],
    ['奥利奥', /奥利奥/gu],
    ['薄荷', /薄荷/gu],
    ['伯爵', /伯爵/gu],
    ['抹茶', /抹茶/gu],
    ['乌龙茶', /乌龙茶/gu],
    ['茉莉', /茉莉/gu],
    ['巧克力', /巧克力/gu],
    ['生巧', /生巧/gu],
    ['香草', /香草/gu],
    ['咖啡', /咖啡/gu],
    ['焦糖', /焦糖/gu],
    ['榛子', /榛子/gu],
    ['开心果', /开心果/gu],
    ['黑芝麻', /黑芝麻/gu],
    ['芋泥', /芋泥/gu],
  ] as const;
  let remaining = text;
  const found: string[] = [];
  for (const [label, pattern] of flavors) {
    const next = remaining.replace(pattern, '');
    if (next !== remaining) found.push(label);
    remaining = next;
  }
  // Repeated title/source text can otherwise add a shorter version of the same flavor.
  return found
    .filter((label) => !found.some((other) => other !== label && other.includes(label)))
    .join('、');
}
