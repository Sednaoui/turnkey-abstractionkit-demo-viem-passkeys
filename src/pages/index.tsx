import { createAccount } from "@turnkey/viem";
import { useTurnkey } from "@turnkey/sdk-react";
import Image from "next/image";
import { useForm } from "react-hook-form";
import axios from "axios";
import { useState, useEffect } from "react";
import { createWalletClient, http, zeroAddress } from "viem";
import { sepolia } from "viem/chains";
import {
  CandidePaymaster,
  MetaTransaction,
  SafeAccountV0_3_0 as SafeAccount,
} from "abstractionkit";

import styles from "./index.module.css";
import { TWalletDetails } from "../types";

type subOrgFormData = {
  subOrgName: string;
};

type signingFormData = {
  messageToSign: string;
};

type TWalletState = TWalletDetails | null;

type TSignedMessage = {
  message: string;
  signature: string;
} | null;

const humanReadableDateTime = (): string => {
  return new Date().toLocaleString().replaceAll("/", "-").replaceAll(":", ".");
};

const bundlerUrl = process.env.NEXT_PUBLIC_BUNDLER_URL as string;
const chainId = BigInt(process.env.NEXT_PUBLIC_CHAIN_ID as string);
const paymasterUrl = process.env.NEXT_PUBLIC_PAYMASTER_RPC as string;
const nodeUrl = process.env.NEXT_PUBLIC_JSON_RPC_NODE_PROVIDER as string;
const sponsorshipId = process.env.NEXT_PUBLIC_SPONSORSHIP_ID as string;

export default function Home() {
  const { turnkey, passkeyClient } = useTurnkey();

  // Wallet is used as a proxy for logged-in state
  const [wallet, setWallet] = useState<TWalletState>(null);
  const [smartWallet, setSmartWallet] = useState<SafeAccount>();
  const [txHash, setTxHash] = useState<string>("");
  const [userOpHash, setUserOpHash] = useState<string>("");

  const { handleSubmit: subOrgFormSubmit } = useForm<subOrgFormData>();
  const { register: signingFormRegister, handleSubmit: signingFormSubmit } =
    useForm<signingFormData>();
  const { register: _loginFormRegister, handleSubmit: loginFormSubmit } =
    useForm();

  // First, logout user if there is no current wallet set
  useEffect(() => {
    (async () => {
      if (!wallet) {
        await turnkey?.logoutUser();
      }
    })();
  });

  const signMessage = async (data: signingFormData) => {
    try {
      setTxHash("");
      setUserOpHash("");
      if (!wallet || !smartWallet) {
        throw new Error("wallet not found");
      }

      const viemAccount = await createAccount({
        client: passkeyClient!,
        organizationId: wallet.subOrgId,
        signWith: wallet.address,
        ethereumAddress: wallet.address,
      });

      const viemClient = createWalletClient({
        account: viemAccount,
        chain: sepolia,
        transport: http(),
      });

      const transaction: MetaTransaction = {
        to: zeroAddress,
        value: BigInt(0),
        data: "0x",
      };

      let userOperation = await smartWallet.createUserOperation(
        [transaction],
        nodeUrl,
        bundlerUrl
      );

      const paymaster = new CandidePaymaster(paymasterUrl);
      const paymasterUserOp =
        await paymaster.createSponsorPaymasterUserOperation(
          userOperation,
          bundlerUrl,
          sponsorshipId
        );
      userOperation = paymasterUserOp[0];

      const { domain, types, messageValue } =
        SafeAccount.getUserOperationEip712Data(userOperation, chainId);

      const eip712Signature = await viemClient.signTypedData({
        domain,
        types,
        message: messageValue,
        primaryType: "SafeOp",
      } as any);

      userOperation.signature =
        SafeAccount.formatEip712SignaturesToUseroperationSignature(
          [wallet.address],
          [eip712Signature]
        );

      const sendUserOpResponse = await smartWallet.sendUserOperation(
        userOperation,
        bundlerUrl
      );
      setUserOpHash(sendUserOpResponse.userOperationHash);

      const receiptResult = await sendUserOpResponse.included();
      setTxHash(receiptResult.receipt.transactionHash);
    } catch (error) {
      console.error("Error:", error);
      alert(
        `Failed to submit user operation: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  const createSubOrgAndWallet = async () => {
    const subOrgName = `Turnkey Viem+Passkey Demo - ${humanReadableDateTime()}`;
    const credential = await passkeyClient?.createUserPasskey({
      publicKey: {
        rp: {
          id: "localhost",
          name: "Turnkey Viem Passkey Demo",
        },
        user: {
          name: subOrgName,
          displayName: subOrgName,
        },
      },
    });

    if (!credential?.encodedChallenge || !credential?.attestation) {
      return false;
    }

    const res = await axios.post("/api/createSubOrg", {
      subOrgName: subOrgName,
      challenge: credential?.encodedChallenge,
      attestation: credential?.attestation,
    });

    const response = res.data as TWalletDetails;
    const smartAccount = SafeAccount.initializeNewAccount([response.address]);

    setSmartWallet(smartAccount);
    setWallet(response);
  };

  const login = async () => {
    try {
      // Initiate login (read-only passkey session)
      const loginResponse = await passkeyClient?.login();
      if (!loginResponse?.organizationId) {
        return;
      }

      const currentUserSession = await turnkey?.currentUserSession();
      if (!currentUserSession) {
        return;
      }

      const walletsResponse = await currentUserSession?.getWallets();
      if (!walletsResponse?.wallets[0].walletId) {
        return;
      }

      const walletId = walletsResponse?.wallets[0].walletId;
      const walletAccountsResponse =
        await currentUserSession?.getWalletAccounts({
          organizationId: loginResponse?.organizationId,
          walletId,
        });
      if (!walletAccountsResponse?.accounts[0].address) {
        return;
      }

      setWallet({
        id: walletId,
        address: walletAccountsResponse?.accounts[0].address,
        subOrgId: loginResponse.organizationId,
      } as TWalletDetails);

      const smartAccount = SafeAccount.initializeNewAccount([
        walletAccountsResponse?.accounts[0].address,
      ]);
      setSmartWallet(smartAccount);
    } catch (e: any) {
      const message = `caught error: ${e.toString()}`;
      console.error(message);
      alert(message);
    }
  };

  return (
    <main className={styles.main}>
      <a href="https://turnkey.com" target="_blank" rel="noopener noreferrer">
        <Image
          src="/logo.svg"
          alt="Turnkey Logo"
          className={styles.turnkeyLogo}
          width={100}
          height={24}
          priority
        />
      </a>
      <div>
        {wallet !== null && (
          <div className={styles.info}>
            Your sub-org ID: <br />
            <span className={styles.code}>{wallet.subOrgId}</span>
          </div>
        )}
        {wallet && (
          <div className={styles.info}>
            Smart Account Address: <br />
            <span className={styles.code}>{smartWallet?.accountAddress}</span>
          </div>
        )}
        {userOpHash && (
          <div className={styles.info}>
            UserOp submited. Waiting for inclusion..
            <br />
            Track the UserOpHash: <br />
            <span className={styles.code}>{userOpHash}</span>
            <br />
            <br />
          </div>
        )}
        {txHash && (
          <div className={styles.info}>
            Transaction Hash: <br />
            <span className={styles.code}>{txHash}</span>
            <br />
          </div>
        )}
      </div>
      {!wallet && (
        <div>
          <h2>Create a new wallet</h2>
          <p className={styles.explainer}>
            We&apos;ll prompt your browser to create a new passkey. The details
            (credential ID, authenticator data, client data, attestation) will
            be used to create a new{" "}
            <a
              href="https://docs.turnkey.com/getting-started/sub-organizations"
              target="_blank"
              rel="noopener noreferrer"
            >
              Turnkey Sub-Organization
            </a>{" "}
            and a new{" "}
            <a
              href="https://docs.turnkey.com/getting-started/wallets"
              target="_blank"
              rel="noopener noreferrer"
            >
              Wallet
            </a>{" "}
            within it.
            <br />
            <br />
            This request to Turnkey will be created and signed by the backend
            API key pair.
          </p>
          <form
            className={styles.form}
            onSubmit={subOrgFormSubmit(createSubOrgAndWallet)}
          >
            <input
              className={styles.button}
              type="submit"
              value="Create new wallet"
            />
          </form>
          <br />
          <br />
          <h2>Already created your wallet? Log back in</h2>
          <p className={styles.explainer}>
            Based on the parent organization ID and a stamp from your passkey
            used to created the sub-organization and wallet, we can look up your
            sub-organization using the{" "}
            <a
              href="https://docs.turnkey.com/api#tag/Who-am-I"
              target="_blank"
              rel="noopener noreferrer"
            >
              Whoami endpoint.
            </a>
          </p>
          <form className={styles.form} onSubmit={loginFormSubmit(login)}>
            <input
              className={styles.button}
              type="submit"
              value="Login to sub-org with existing passkey"
            />
          </form>
        </div>
      )}
      {wallet !== null && (
        <div>
          <h2>Now let&apos;s submit a userOp!</h2>
          <p className={styles.explainer}>
            We&apos;ll use Turnkey as an owner to the smart account{" "}
            <a
              href="https://viem.sh/docs/accounts/custom.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              with Viem custom account
            </a>{" "}
            to do this, using{" "}
            <a
              href="https://www.npmjs.com/package/@turnkey/viem"
              target="_blank"
              rel="noopener noreferrer"
            >
              @turnkey/viem
            </a>
          </p>
          <form
            className={styles.form}
            onSubmit={signingFormSubmit(signMessage)}
          >
            <input className={styles.button} type="submit" value="Submit" />
          </form>
        </div>
      )}
    </main>
  );
}
