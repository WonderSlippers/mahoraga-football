"use client"

import { useSyncExternalStore } from "react"

const MOBILE_BREAKPOINT = 768
const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(listener: () => void) {
  const media = window.matchMedia(query)
  media.addEventListener("change", listener)
  return () => media.removeEventListener("change", listener)
}

function current() {
  return window.matchMedia(query).matches
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, current, () => false)
}
