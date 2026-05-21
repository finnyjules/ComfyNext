import { reactive, ref } from "vue";
import { defineNuxtPlugin, useHead, useState, useRouter, useRequestHeaders } from "#imports";
import { preference, dataValue, storage, storageKey } from "#build/color-mode-options.mjs";
export default defineNuxtPlugin((nuxtApp) => {
  const colorMode = nuxtApp.ssrContext?.islandContext ? ref({}).value : useState("color-mode", () => reactive({
    preference,
    value: preference,
    unknown: true,
    forced: false
  })).value;
  const htmlAttrs = {};
  if (storage === "cookie") {
    const { cookie } = useRequestHeaders(["cookie"]);
    const [, value] = cookie?.split("; ").map((s) => s.split("=")).find(([k]) => k === storageKey) ?? [];
    if (value) {
      colorMode.preference = value;
    }
  }
  useHead({ htmlAttrs });
  useRouter().afterEach((to) => {
    const forcedColorMode = to.meta.colorMode;
    if (forcedColorMode && forcedColorMode !== "system") {
      htmlAttrs["data-color-mode-forced"] = forcedColorMode;
      colorMode.value = forcedColorMode;
      if (dataValue) {
        htmlAttrs[`data-${dataValue}`] = colorMode.value;
      }
      colorMode.forced = true;
    } else if (forcedColorMode === "system") {
      console.warn("You cannot force the colorMode to system at the page level.");
    }
  });
  nuxtApp.provide("colorMode", colorMode);
});
