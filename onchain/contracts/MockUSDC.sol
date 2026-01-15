// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockUSDC {
  string public name = "USD Coin";
  string public symbol = "USDC";
  uint8 public immutable decimals = 6;

  uint256 public totalSupply;
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  event Transfer(address indexed from, address indexed to, uint256 value);
  event Approval(address indexed owner, address indexed spender, uint256 value);

  constructor(uint256 initialSupply, address initialHolder) {
    _mint(initialHolder, initialSupply);
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    _transfer(msg.sender, to, amount);
    return true;
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    uint256 currentAllowance = allowance[from][msg.sender];
    require(currentAllowance >= amount, "ALLOWANCE");
    unchecked {
      allowance[from][msg.sender] = currentAllowance - amount;
    }
    _transfer(from, to, amount);
    return true;
  }

  function mint(address to, uint256 amount) external {
    _mint(to, amount);
  }

  function _transfer(address from, address to, uint256 amount) internal {
    require(to != address(0), "ZERO_TO");
    uint256 balance = balanceOf[from];
    require(balance >= amount, "BALANCE");
    unchecked {
      balanceOf[from] = balance - amount;
      balanceOf[to] += amount;
    }
    emit Transfer(from, to, amount);
  }

  function _mint(address to, uint256 amount) internal {
    require(to != address(0), "ZERO_TO");
    totalSupply += amount;
    balanceOf[to] += amount;
    emit Transfer(address(0), to, amount);
  }
}
