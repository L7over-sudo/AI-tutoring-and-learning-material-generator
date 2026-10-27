export function naturalSort(items, selector = (item) => item) {
  const collator = new Intl.Collator("zh-CN", {
    numeric: true,
    sensitivity: "base"
  });
  return [...items].sort((a, b) => collator.compare(selector(a), selector(b)));
}
