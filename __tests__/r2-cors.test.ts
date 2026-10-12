import rules from "@/deploy/r2-cors.json";

function allows(origin: string, method: string, header: string) {
  return rules.some(rule => rule.AllowedOrigins.some(value => value === "*" || value === origin) &&
    rule.AllowedMethods.includes(method) && rule.AllowedHeaders.some(value => value === "*" || value.toLowerCase() === header.toLowerCase()));
}

test.each(["https://www.bilibili.com", "https://www.youtube.com", "https://another-video.example"])("presigned extension PUT works from %s", origin => {
  expect(allows(origin, "PUT", "Content-Type")).toBe(true);
  expect(allows(origin, "GET", "Range")).toBe(false);
  expect(allows(origin, "DELETE", "Content-Type")).toBe(false);
});
test.each(["https://www.instantmemeeditandpost.online", "https://instantmemeeditandpost.online", "http://localhost:3000"])("editor origins retain read and upload access: %s", origin => {
  expect(allows(origin, "GET", "Range")).toBe(true);
  expect(allows(origin, "HEAD", "Content-Type")).toBe(true);
  expect(allows(origin, "PUT", "Content-Type")).toBe(true);
});
test("wildcard origins only permit signed upload browser access, not wildcard reads", () => {
  const wildcard = rules.filter(rule => rule.AllowedOrigins.includes("*"));
  expect(wildcard).toHaveLength(1);
  expect(wildcard[0].AllowedMethods).toEqual(["PUT"]);
  expect(wildcard[0].AllowedHeaders).toEqual(["Content-Type"]);
});
