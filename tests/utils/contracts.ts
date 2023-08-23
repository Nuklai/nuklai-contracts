import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TestToken } from "@typechained";
import { AddressLike } from "ethers";
import { deployments, ethers } from "hardhat";

export async function getTestTokenContract(
  deployer: HardhatEthersSigner,
  opts: {
    mint?: bigint
  }
) {
  const DeployedToken = await deployments.deploy("TestToken", {
    from: deployer.address,
  });

  const token = (await ethers.getContractAt(
    "TestToken",
    DeployedToken.address
  )) as unknown as TestToken;

  if (opts?.mint && opts.mint > 0) {
    await token.connect(deployer).mint(deployer as AddressLike, opts.mint);
  }

  return token;
}
