import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-toolbox";
import "@typechain/hardhat";
import "solidity-coverage";
import "hardhat-deploy";
import "hardhat-deploy-ethers";
import { network } from "./utils";

import "./tasks/set_deployer_fee_model_percentage";
import "./tasks/set_deployer_fee_beneficiary";
import "./tasks/set_dataset_fee_model";
import "./tasks/set_fragment_implementation";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.18",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
    overrides: {
      "contracts/DatasetFactory.sol": {
        version: "0.8.18",
        settings: {
          viaIR: true,
        },
      },
    },
  },
  networks: {
    goerli: {
      url: network.getNodeUrl("goerli"),
      accounts: network.getAccounts("goerli"),
      verify: {
        etherscan: {
          apiKey: process.env.ETHERSCAN_API_KEY_GOERLI,
        },
      },
    },
    fuji: {
      url: network.getNodeUrl("fuji"),
      accounts: network.getAccounts("fuji"),
      verify: {
        etherscan: {
          apiKey: process.env.ETHERSCAN_API_KEY_FUJI,
        },
      },
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
