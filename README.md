# Solana Transfer Transaction

A step-by-step implementation of creating and sending SOL transfer transactions on Solana Devnet.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
SENDER_SECRET_KEY=your_base58_encoded_secret_key
RECEIVER_PUBLIC_KEY=recipient_solana_address
```

## How It Works

1. **Connect to Devnet** - Establish RPC connection
2. **Fund Payer** - Request airdrop if balance is low
3. **Create Instruction** - Build transfer instruction
4. **Build Transaction** - Add instruction and set blockhash
5. **Sign Transaction** - Sign with sender's keypair
6. **Serialize & Send** - Encode and submit to network
7. **Confirm** - Wait for transaction confirmation

## Run

```bash
npx ts-node src/index.ts
```
