import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TestToken } from "@typechained";
import { deployments, ethers } from "hardhat";

export async function getTestTokenContract(
  beneficiary: HardhatEthersSigner,
  opts: {
    mint?: bigint;
  }
) {
  const { dtAdmin } = await ethers.getNamedSigners();

  const DeployedToken = await deployments.deploy("TestToken", {
    from: dtAdmin.address,
  });

  const token = (await ethers.getContractAt(
    "TestToken",
    DeployedToken.address,
    dtAdmin
  )) as unknown as TestToken;

  if (opts?.mint && opts.mint > 0) {
    await token.connect(dtAdmin).mint(beneficiary.address, opts.mint);
  }

  return token.connect(beneficiary);
}
