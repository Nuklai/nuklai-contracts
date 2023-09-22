import { expect } from 'chai';
import { ZeroAddress, parseUnits } from 'ethers';
import { deployments } from 'hardhat';
import { setupUsers } from './utils/users';

const setup = async () => {
  await deployments.fixture(['TestToken']);

  const users = await setupUsers();

  return {
    users,
  };
};

describe('TestToken', () => {
  it('Should admin mint tokens', async function () {
    const { users } = await setup();

    await expect(users.dtAdmin.Token!.mint(users.user.address, parseUnits('100', 18)))
      .to.emit(users.dtAdmin.Token, 'Transfer')
      .withArgs(ZeroAddress, users.user.address, parseUnits('100', 18));
  });
});
