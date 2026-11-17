declare module 'virtual:starter' {
  const starter: {
    /** The starter's folder in examples/. */
    name: string;
    /** Its source files by path inside it. */
    sources: Record<string, string>;
    build: import('../bundler/index.ts').BundleResult;
  };
  export default starter;
}

declare module '*?raw' {
  const content: string;
  export default content;
}
