import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-toolbox";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-deploy-ethers";
import { network } from "./utils";

const config: HardhatUserConfig = {
  solidity: "0.8.18",
  networks: {
    goerli: {
      url: network.getNodeUrl("goerli"),
      accounts: network.getAccounts("goerli"),
    },
    fuji: {
      url: network.getNodeUrl("fuji"),
      accounts: network.getAccounts("fuji"),
    },
  },
  namedAccounts: {
    dtAdmin: 0,
    user: 1,
    datasetOwner: 2,
    contributor: 3,
    subscriber: 4,
    consumer: 5,
    secondConsumer: 6,
  },
};

export default config;
