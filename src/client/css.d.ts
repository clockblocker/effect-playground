// Bun bundles a stylesheet the page imports for its side effect, as
// main.tsx does styles.css; bun-types declares no module for it.
declare module "*.css";
