// ---------------------------
// Overview
// ---------------------------

// This file creates and handles a blind credential on the frontend
//
// It does these main things:
//
// 1. Gets the RSA public key from the Flask backend
//
// 2. Creates a random private token
//
// 3. Creates a random blinding value
//
// 4. Blinds the token so the backend cannot see the real token
//
// 5. Sends the blinded token to the backend in another part of the app
//
// 6. Later unblinds the backend's signed blinded token
//
// 7. Produces a valid RSA signature for the real token

// hex easy to store BigInt easy to Math 

// Converts a hex string into a BigInt number
function hexToBigInt(hex) {
  // Add 0x so JavaScript knows this is a hex number therefore converts it into big int
  return BigInt("0x" + hex);
}


// Converts a BigInt number into a hex string
function bigIntToHex(value) {
  // Convert the BigInt into base 16 text
  let hex = value.toString(16);

  // If the hex length is odd, add a leading zero
  // This keeps the hex in full byte pairs
  if (hex.length % 2 !== 0) hex = "0" + hex;

  // Return the final hex string
  return hex;
}


// Calculates base^exponent mod modulus
function modPow(base, exponent, modulus) {
  // Start the result at 1
  let result = 1n;

  // Keep the base inside the modulus range
  base = base % modulus;

  // Keep looping while there is an exponent left
  while (exponent > 0n) {
    // If the current exponent bit is 1, multiply the result by the base
    if (exponent % 2n === 1n) {
      result = (result * base) % modulus;
    }

    // Divide the exponent by 2
    // This moves it to the next bit
    exponent = exponent / 2n;

    // Square the base for the next loop step
    base = (base * base) % modulus;
  }

  // Return the final modular power result
  return result;
}


// Finds the greatest common divisor of two BigInt values
// This is used to check that the blinding value works with RSA
function gcd(a, b) {
  // Keep looping until b becomes zero
  while (b !== 0n) {
    // Store the old b value
    const temp = b;

    // Replace b with the remainder of a divided by b
    b = a % b;

    // Replace a with the old b value
    a = temp;
  }

  // Return the greatest common divisor
  return a;
}


// Finds the modular inverse of a modulo m
// This is used to undo the blinding later
function modInverse(a, m) {
  // Save the original modulus
  let m0 = m;

  // Start the first helper value
  let x0 = 0n;

  // Start the second helper value
  let x1 = 1n;

  // Run the extended Euclidean algorithm
  while (a > 1n) {
    // Work out how many times m goes into a
    const q = a / m;

    // Temporarily store m
    let t = m;

    // Update m to the remainder
    m = a % m;

    // Update a to the old m
    a = t;

    // Temporarily store x0
    t = x0;

    // Update x0
    x0 = x1 - q * x0;

    // Update x1
    x1 = t;
  }

  // If the result is negative, move it back into the positive modulus range
  if (x1 < 0n) {
    x1 += m0;
  }

  // Return the modular inverse
  return x1;
}


// Creates secure random bytes in the browser
function randomBytes(length) {
  // Create a byte array of the requested length
  const array = new Uint8Array(length);

  // Fill the array with secure random values from the browser
  window.crypto.getRandomValues(array);

  // Return the random byte array
  return array;
}


// Converts bytes into a hex string
function bytesToHex(bytes) {
  // Convert each byte to 2-character hex and join everything together
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}


// Creates a random BigInt that is valid for RSA blinding
function randomBigIntLessThan(n) {
  // This will hold the random number
  let r;

  // Keep trying until r is valid
  do {
    // Generate 32 random bytes
    const bytes = randomBytes(32);

    // Convert the random bytes into hex
    const hex = bytesToHex(bytes);

    // Convert the hex into a BigInt
    r = hexToBigInt(hex);

    // Repeat if r is too small, too large, or not coprime with n
    // gcd(r, n) must be 1 so r has a modular inverse
  } while (r <= 1n || r >= n || gcd(r, n) !== 1n);

  // Return the valid random blinding value
  return r;
}


// Creates a blind credential request
// This creates the real token, blinds it, and returns the data needed later
export async function createBlindCredential() {
  // Ask the backend for the RSA public key
  const response = await fetch("http://localhost:5000/public-key");

  // Convert the backend response into JSON
  const publicKey = await response.json();

  // Convert the RSA modulus from hex into BigInt
  const n = hexToBigInt(publicKey.n);

  // Convert the RSA public exponent from hex into BigInt
  const e = hexToBigInt(publicKey.e);

  //1b Create a random 32-byte private token == user cred
  const tokenBytes = randomBytes(32);

  // Convert the token bytes into hex
  const tokenHex = bytesToHex(tokenBytes);

  // Convert the token into a BigInt for RSA maths
  const m = hexToBigInt(tokenHex);

  // 2b Token is blinded 
  // Create a random blinding value
  const r = randomBigIntLessThan(n);

  // Blind the token using this formula:
  // blindedToken = token * r^e mod n
  // The backend can sign this blinded token
  // but it cannot see the original token
  const blindedToken = (m * modPow(r, e, n)) % n;

  // Calculate the inverse of r
  // This is needed later to unblind the backend's signature
  const rInverse = modInverse(r, n);

  // Return the values the app needs
  return {
    // The real private token
    // This should be kept by the frontend
    tokenHex,

    //3b The blinded token
    // This is what gets sent to the backend for signing
    blindedTokenHex: bigIntToHex(blindedToken),

    // The inverse of the blinding value
    // This is used later to unblind the signature
    rInverseHex: bigIntToHex(rInverse),

    // The RSA modulus
    // This is needed later when unblinding the signature
    nHex: publicKey.n,
  };
}

//6b
// Unblinds the backend's signed blinded token
// This gives a valid RSA signature for the original token
export function unblindSignature(signedBlindedHex, rInverseHex, nHex) {
  // Convert the signed blinded token from hex into BigInt
  const signedBlinded = hexToBigInt(signedBlindedHex);

  // Convert the inverse blinding value from hex into BigInt
  const rInverse = hexToBigInt(rInverseHex);

  // Convert the RSA modulus from hex into BigInt
  const n = hexToBigInt(nHex);

  // Remove the blinding from the signed blinded token
  // signature = signedBlinded * rInverse mod n
  const signature = (signedBlinded * rInverse) % n;

  // Return the real signature as hex
  return bigIntToHex(signature);
}