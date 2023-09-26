# Datatunnel Smart Contracts

This repository contains the smart contracts for the Datatunnel protocol.

The protocol empowers Dataset owners to seamlessly integrate, configure, and maintain their Datasets on-chain. It achieves this by issuing ERC721 tokens, each serving as a unique digital representation of a Dataset. These tokens not only signify ownership but also act as a gateway for contributors.

In addition, the protocol serves as a marketplace, enabling data providers (owners of datasets) to publish and monetize their data through subscriptions from consumers. It goes beyond data management and allows users to actively contribute to these datasets.

Contributions are recorded on-chain as distinct ERC721 tokens called fragments, each representing a valuable addition to a Dataset. Contributors can be rewarded with revenue for their valuable contributions, fostering collaboration and innovation within the ecosystem. This multifaceted approach transforms data management into a dynamic and inclusive process, benefitting all participants.

---

#### _Developers are required to have some familiarity with:_

- [Solidity](https://solidity.readthedocs.io/en/latest/)
- [yarn](https://yarnpkg.com/getting-started)
- [TypeScript](https://www.typescriptlang.org/)
- [ethers.js](https://docs.ethers.org/v6/)
- [hardhat](https://hardhat.org/)

---

## Table of Contents

<details>
<summary><strong>Expand</strong></summary>

- [Install](#install)
- [Usage](#usage)
- [Contributing](#contributing)
- [Development Guidlines](#development-guidelines)
- [Contracts Description](#contracts-description)

</details>

## Install

To install all the dependencies of this repo, execute the following command:

```bash
yarn
```

or

```bash
yarn install
```

## Usage

### 1. Build contracts

To compile contracts, export ABIs, and generate TypeScript interfaces, execute the following command:

```bash
yarn build
```

### 2. Reset Environment

To remove cached and temporary files, execute the following command:

```bash
yarn clean
```

### 3. Tests

To run all unit tests, execute the following command:

```bash
yarn test
```

### 4. Coverage

To generate a coverage report, execute the following command:

```bash
yarn coverage
```

### 5. Contracts Size

To generate a contracts size report, execute the following command:

```bash
yarn contract-size
```

### 6. Linting

To run linting on all configured source files (`*.sol`, `*.ts`, `*.js`, `*.json`), execute the following command:

```bash
yarn lint
```

## Contributing

1. Fork it or Clone it
2. Create your feature or fix branch (`git checkout -b feature/foo`)
3. Commit your changes (`git commit -am 'add something'`)
4. Push the branch (`git push origin feature/foo`)
5. Create a new Pull Request

## Development guidelines

For best practices and guidelines, read more [here](https://allianceblock.io/).

## Contracts Description

|                  Smart Contract                   |                                                                                                                            Description                                                                                                                            |
| :-----------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
|               **`DatasetFactory`**                | Facilitates the streamlined integration and configuration of Datasets in the Data Tunnel protocol, in a single transaction. Each Dataset integration results in the minting of an ERC721 token (Dataset NFT) which is transferred to the respective Dataset owner |
|                 **`DatasetNFT`**                  |                                                 The protocol's core extends ERC721 to mint tokens representing unique datasets, enabling dataset configuration, and maintaining a record of these configurations                                                  |
|                 **`FragmentNFT`**                 |                                       An ERC721 extension where each token represents an incorporated contribution to a specific dataset. Contribution types are encoded as `tags` which are linked to the respective token                                       |
|             **`DistributionManager`**             |                                                       Manages the distribution of fees to dataset owners and contributors. It provides configuration options for fee distribution percentages among parties                                                       |
|   **`GenericSingleDatasetSubscriptionManager`**   |                                                                          An abstract contract serving as the foundation for managing single dataset subscriptions and related operations                                                                          |
| **`ERC20SubscriptionManager`** |                                                      Extends the abstract `GenericSingleDatasetSubscriptionManager` contract to handle dataset subscriptions using ERC20 or native tokens as payment                                                       |
|               **`VerifierManager`**               |                                                      Configures and coordinates verifiers for datasets' proposed contributions, handling approval or rejection operations based on the configured verifiers                                                       |
|           **`AcceptManuallyVerifier`**            |                                                                 Verifier that provides the resolution mechanisms for the Dataset owner to either accept or reject proposed contributions manually                                                                 |
|              **`AcceptAllVerifier`**              |                                                                                             Verifier that automatically accepts all proposed contributions by default                                                                                             |
