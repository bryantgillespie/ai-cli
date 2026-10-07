const blocked = [
  "ai-gateway.vercel.sh",
  "api.vercel.com",
  "@vercel/oidc",
  "@ai-sdk/gateway",
  "AI_GATEWAY_API_KEY",
];

const bundle = await Bun.file(
  new URL("../dist/index.js", import.meta.url)
).text();
const found = blocked.filter((value) => bundle.includes(value));

if (found.length > 0) {
  throw new Error(
    `built CLI contains blocked gateway code: ${found.join(", ")}`
  );
}
