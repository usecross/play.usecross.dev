declare module 'virtual:starter-build' {
  const build: import('../bundler/index.ts').BundleResult;
  export default build;
}

declare module '*?raw' {
  const content: string;
  export default content;
}
