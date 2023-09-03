import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TestToken } from "@typechained";
import { ethers } from "hardhat";
import { getTestTokenContract } from "./contracts";

interface Signer extends HardhatEthersSigner {
  Token?: TestToken;
}

export async function setupUsers() {
  const namedAccounts = await ethers.getNamedSigners();

  const users: Record<string, Signer> = {};

  for (const namedAccount in namedAccounts) {
    users[namedAccount] = namedAccounts[namedAccount];
    users[namedAccount].Token = await getTestTokenContract(
      users[namedAccount],
      {
        mint: ethers.parseUnits("100000000", 18),
      }
    );
  }

  return users;
}
