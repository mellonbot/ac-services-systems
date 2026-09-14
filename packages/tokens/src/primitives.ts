/**
 * TIER 1 — primitives. Raw values, referenced by NOTHING outside tier 2.
 * A component that reaches in here has hard-coded a colour, and a hard-coded
 * colour cannot be re-pointed for a white-label tenant.
 */
export const PRIMITIVES = Object.freeze({
  gray: { 0: "#ffffff", 50: "#f7f8f9", 100: "#eceef1", 300: "#c3c8d0", 500: "#6b7481", 700: "#3a4049", 900: "#14171b", 1000: "#000000" },
  blue: { 500: "#2a6df4", 600: "#1b56cc", 700: "#153f95" },
  amber: { 400: "#ffb020", 500: "#e08c00" },
  red: { 500: "#d6342c", 600: "#ad2620" },
  green: { 500: "#1f8a4c" },
  space: { 0: "0px", 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 8: "32px" },
  radius: { sm: "3px", md: "6px", lg: "10px" },
  text: { xs: "11px", sm: "13px", md: "15px", lg: "18px", xl: "22px" },
});
