/// <reference types="vite/client" />

/**
 * 声明window上的全局变量
 */
declare global {
  interface Window {
    __coverage__: any;
  }
}

export {}