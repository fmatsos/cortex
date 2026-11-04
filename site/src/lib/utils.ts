import { twMerge } from "tailwind-merge";

/** shadcn-svelte's `cn`, without `clsx`: twMerge already accepts strings, arrays and falsy values. */
export const cn = (...classes: Parameters<typeof twMerge>) => twMerge(...classes);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
