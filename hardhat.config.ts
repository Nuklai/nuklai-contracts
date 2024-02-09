import 'dotenv/config';
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import '@typechain/hardhat';
import 'solidity-coverage';
import 'hardhat-deploy';
import 'hardhat-deploy-ethers';
import 'hardhat-contract-sizer';
import 'hardhat-dependency-compiler';
import { network } from './utils';
import './tasks';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.18',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
        details: {
          yul: true, // this resolves the issue when running coverage `Stack too deep when compiling inline assembly: Variable headStart is 1 slot(s) too deep inside the stack`
        },
      },
      viaIR: true,
    },
    overrides: {
      'contracts/DatasetFactory.sol': {
        version: '0.8.18',
        settings: {
          viaIR: true,
        },
      },
    },
  },
  networks: {
    goerli: {
      url: network.getNodeUrl('goerli'),
      accounts: network.getAccounts('goerli'),
      verify: {
        etherscan: {
          apiKey: process.env.ETHERSCAN_API_KEY_GOERLI,
        },
      },
    },
    fuji: {
      url: network.getNodeUrl('fuji'),
      accounts: network.getAccounts('fuji'),
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
    secondSubscriber: 5,
    consumer: 6,
    secondConsumer: 7,
  },

  dependencyCompiler: {
    paths: [
      '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol',
      '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
    ],
    keep: true,
  },
};

export default config;
