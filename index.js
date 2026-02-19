import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const C = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  reset: "\x1b[0m"
};

let treasury = 0;

function header() {
  console.clear();
  console.log(C.red + C.bold + "HUNTER TREASURY" + C.reset);
  console.log(C.yellow + "⚔ COMBAT TREASURY ENGINE ⚔" + C.reset);
  console.log("");
  console.log(C.cyan + "forge | allocate | drain | status | exit" + C.reset);
  console.log("");
}

function drawTable(title, value) {
  console.log(C.yellow + "┌──────────────────────────────┐" + C.reset);
  console.log(C.yellow + "│ " + C.bold + title.padEnd(28) + C.reset + C.yellow + "│" + C.reset);
  console.log(C.yellow + "├──────────────────────────────┤" + C.reset);
  console.log(C.yellow + "│ Balance : " + value.toString().padEnd(17) + "│" + C.reset);
  console.log(C.yellow + "└──────────────────────────────┘" + C.reset);
  console.log("");
}

function prompt() {
  rl.question(C.red + "hunter> " + C.reset, handle);
}

function forge() {
  rl.question("Initial Treasury: ", (amt) => {
    treasury = parseFloat(amt) || 0;
    drawTable("VAULT FORGED", treasury);
    prompt();
  });
}

function allocate() {
  rl.question("Allocate Amount: ", (amt) => {
    const val = parseFloat(amt) || 0;
    treasury += val;
    drawTable("RESOURCES CAPTURED", treasury);
    prompt();
  });
}

function drain() {
  rl.question("Drain Amount: ", (amt) => {
    const val = parseFloat(amt) || 0;
    if (val > treasury) {
      console.log(C.red + "\n⚠ INSUFFICIENT TREASURY POWER ⚠\n" + C.reset);
    } else {
      treasury -= val;
      drawTable("TREASURY DRAINED", treasury);
    }
    prompt();
  });
}

function status() {
  drawTable("CURRENT TREASURY STATUS", treasury);
  prompt();
}

function handle(cmd) {
  switch (cmd.trim()) {
    case "forge":
      forge();
      break;
    case "allocate":
      allocate();
      break;
    case "drain":
      drain();
      break;
    case "status":
      status();
      break;
    case "exit":
      console.log(C.green + "\nHunter Treasury Shutdown\n" + C.reset);
      rl.close();
      break;
    default:
      console.log(C.red + "Unknown Command\n" + C.reset);
      prompt();
  }
}

header();
prompt();
