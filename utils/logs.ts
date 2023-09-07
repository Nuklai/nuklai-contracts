import "dotenv/config";

export function disableConsoleLogsOnTesting() {
  if (
    process.env.TEST === "true" &&
    process.env.HARDHAT_DEPLOY_FIXTURE !== "true"
  ) {
    console.log = function () {};
  }
}
