import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@typechain/hardhat";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.18",
        settings: {
            optimizer: {
                enabled: true,
                runs: 2000000,
            },
        },
        overrides: {
            "contracts/DatasetFactory.sol": {
                settings: {
                    viaIR: true,
                }
            }
        }
    },
};

export default config;
