import { ContractFunctionExecutionError, ContractFunctionRevertedError } from "viem";
import { accountErrors, revertReason } from "./revert.js";

function assertEq(actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(`expected ${expected}, got ${actual}`);
  }
}

const slippage = new ContractFunctionRevertedError({
  abi: accountErrors,
  data: "0x7dd37f70",
  functionName: "guard",
});
const wrapped = new ContractFunctionExecutionError(slippage, {
  abi: accountErrors,
  functionName: "guard",
});
const rawOnly = new ContractFunctionRevertedError({
  abi: [],
  data: "0x7dd37f70",
  functionName: "guard",
});
const notKeeper = new ContractFunctionRevertedError({
  abi: [],
  data: "0xf512b278",
  functionName: "guard",
});

assertEq(revertReason(slippage), "Slippage()");
assertEq(revertReason(wrapped), "Slippage()");
assertEq(revertReason(rawOnly), "Slippage()");
assertEq(revertReason(new Error("execution reverted: 0x7dd37f70")), "Slippage()");
assertEq(revertReason(notKeeper), "NotKeeper()");
assertEq(revertReason(new Error("execution reverted: 0xf512b278")), "NotKeeper()");

if (revertReason(slippage) === "NotKeeper()") {
  throw new Error("Slippage was labeled as the Wave 1 keeper error");
}

console.log("revert checks ok");
