// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DeterministicDeployer {
  event Deployed(address indexed deployedAddress, bytes32 indexed salt);

  function deploy(bytes32 salt, bytes memory bytecode) external returns (address deployedAddress) {
    require(bytecode.length > 0, "BYTECODE_EMPTY");

    assembly {
      deployedAddress := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
    }

    require(deployedAddress != address(0), "DEPLOY_FAILED");
    emit Deployed(deployedAddress, salt);
  }

  function predictAddress(bytes32 salt, bytes32 bytecodeHash) external view returns (address) {
    return address(uint160(uint(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, bytecodeHash)))));
  }
}
