import {
    Connection,       // RPC ke through cluster se baat karne ke liye.
    Keypair,          // private/public key pair; yahi signer hota hai.
    PublicKey,        // public address (base58 string se PublicKey object).
    SystemProgram,    // built‑in program jo SOL transfer, account create, etc karta hai.
    Transaction,      // jo actual transaction container hai.
    LAMPORTS_PER_SOL, //  SOL → lamports conversion constant.
    clusterApiUrl,    // cluster ke RPC URL ko get karne ke liye.
} from '@solana/web3.js';

/* 
1. Devnet pe connect 

Under the hood: Connection WebSocket + HTTP RPC clients internally create karta hai, jo getRecentBlockhash, sendRawTransaction, etc expose karte hain.

*/
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

/*
2. New Keypair: 

payer.publicKey → PublicKey object
payer.secretKey → Uint8Array(64) (ed25519 private + public key bytes)

*/
const payer = Keypair.generate();
console.log('Payer Public Key:', payer.publicKey.toBase58());

/*
3. Airdrop SOL:

Under the hood: connection.requestAirdrop() internally sendRequest('requestAirdrop', [pubkey, lamports]) karta hai.

getBalance(pubkey) → lamports
requestAirdrop(pubkey, amount) → system program ke through faucet tx send hoti hai.

*/

async function fundPayerIfNeeded() {
  const balance = await connection.getBalance(payer.publicKey);
  console.log('Current balance:', balance, 'lamports');

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.log('Requesting airdrop of 1 SOL...');
    const sig = await connection.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('Airdrop signature:', sig);
  }
}

/*
3.1. Fund payer account with SOL before creating transaction:

This ensures payer has sufficient balance to cover the transfer amount and transaction fees.
Without this, the transaction simulation will fail with "Attempt to debit an account but found no record of a prior credit".

*/

await fundPayerIfNeeded();

/*
4. Create Transfer Instruction:

Yeha Internally,
SystemProgram.transfer(...) ek TransactionInstruction object return karta hai:

→ programId: SystemProgram.programId (11111111111111111111111111111111)

→ keys: [{ pubkey, isSigner, isWritable }, ...]
    fromPubkey → isSigner: true, isWritable: true
    toPubkey → isSigner: false, isWritable: true

→ data: Buffer: Binary encoding of instruction enum = Transfer (2) + u64 lamports

*/

const recipient = new PublicKey('8oqK9tb7QREwG9w3JRZuvWvaS9K7YBtyY2eeCBVEQXmV');

const tranferInstruction = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: recipient,
    lamports: 0.1 * LAMPORTS_PER_SOL,
});

/*
5. Transaction Object:

Under the hood: Transaction ek container hai jo multiple TransactionInstruction objects hold kar sakta hai.

Yeha Transaction ke andar abhi:

instructions: TransactionInstruction[] ki list.
Payer, blockhash, signatures abhi set nahi huay.

*/

const transaction = new Transaction();

// 5.1 Instruction
transaction.add(tranferInstruction);

/*
Transaction ke andar ab:

instructions: TransactionInstruction[] ki list.
Payer, blockhash, signatures abhi set nahi huay.

*/

// 5.2 Recent blockhash set karna zaroori hai taaki transaction valid ho.
const lastestBlockhash = await connection.getLatestBlockhash('confirmed');

/*
 latestBlockhash:
 {
   blockhash: string;
   lastValidBlockHeight: number;
 }

Old API getRecentBlockhash() tha, ab getLatestBlockhash recommended hai.
*/

console.log('Recent blockhah:', lastestBlockhash.blockhash);

// 5.3 Manually Transaction ke fields set krna
transaction.recentBlockhash = lastestBlockhash.blockhash;
transaction.feePayer = payer.publicKey;

/*

Ab:

feePayer → kisi ek signer ka pubkey jo fees pay karega.
recentBlockhash → is blockhash se tx ko tie kar diya; kuch slots ke baad invalid ho jayega.
Is point pe:

transaction.instructions: populated
transaction.recentBlockhash: set
transaction.feePayer: set
transaction.signatures: abhi empty / placeholder hai.

*/

// 6. Sign Transaction
transaction.sign(payer);

/*

1. Transaction ko “message” mein convert karti hai:

    compileMessage():
        Unique account list banata hai.
        Header (numRequiredSignatures, numReadonlySignedAccounts, etc).
        Recent blockhash add karta hai.
        Instructions ko account indices + data ke sath encode karta hai.
    Ye sab milke ek Message banta hai (binary form).

2. Message ko serialize karta hai (message.serialize()).   

3. Har signer ke liye:

    ed25519 signature: sign(sha256(messageBytes)).
    Signature ek 64‑byte array hoti hai.

4. transaction.signatures array mein har signer ka { publicKey, signature } store karta hai.

*/

// 7. Raw serialize + send

const rawTransaction = transaction.serialize(); // Buffer of full tx data: Yeh buffer Network ko bheja jata hai via sendRawTransaction.

const txSignature  = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false, // By default preflight simulation run hoti hai
});
console.log('Submitted transaction siganture:', txSignature);

// 8. Confirm Transaction

const confirmation = await connection.confirmTransaction(
{
    signature: txSignature,
    blockhash: lastestBlockhash.blockhash,
    lastValidBlockHeight: lastestBlockhash.lastValidBlockHeight,
},
'confirmed'
);

/*

Yaha:

sendRawTransaction → RPC method sendTransaction call karta hai aur serialized bytes JSON base64 ke through bhejta hai.
confirmTransaction → blockhash / blockheight ke context mein wait karta hai ke tx finalized / confirmed ho jaye.

*/






