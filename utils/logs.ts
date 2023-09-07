import "dotenv/config";

export function disableConsoleLogs() {
  if (process.env.TEST === "true") {
    console.log = function () {};
  }
}
