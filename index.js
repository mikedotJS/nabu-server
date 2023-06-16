const net = require("net");
require("dotenv").config();

const PORT = process.env.PORT;

class Server {
  constructor(port) {
    this.port = port;
    this.clients = [];
    this.channels = {};
  }

  start() {
    const server = net.createServer((socket) => {
      const client = this.createClient(socket);
      this.clients.push(client);

      socket.on("data", (data) => {
        const message = data.toString().trim();

        if (client.username === null) {
          this.handleUsername(client, message);
        } else {
          this.handleMessage(client, message);
        }
      });

      socket.on("end", () => {
        this.handleDisconnect(client);
      });

      socket.on("error", (error) => {
        console.log(`Error: ${error}`);
      });
    });

    server.listen(this.port, () => {
      console.log(`Server is listening on port ${this.port}`);
    });
  }

  createClient(socket) {
    return {
      socket,
      username: null,
      channel: null,
      lastMessage: null,
    };
  }

  handleUsername(client, username) {
    const trimmedUsername = username.trim();

    if (this.isUsernameTaken(trimmedUsername)) {
      client.socket.write(
        "Username is already taken. Please choose a different username.\n"
      );
      return;
    }

    client.username = trimmedUsername;
    client.socket.write(
      `Welcome, ${client.username}! You are now connected.\n`
    );
    this.sendAvailableCommands(client);
  }

  sendAvailableCommands(client) {
    const commands = [
      "/join <channel> - Join a channel",
      "/leave <channel> - Leave a channel",
      "/pm <recipient> <message> - Send a private message",
      "/reply <message> or /r <message> - Reply to the last private message received",
      "/react <emoji> - React to a message with an emoji",
      "/channels - List all available channels",
      "/quit - Disconnect from the server",
    ];

    client.socket.write("Available commands:\n");
    commands.forEach((command) => {
      client.socket.write(`- ${command}\n`);
    });

    client.socket.write("Enter a command: ");
  }

  isUsernameTaken(username) {
    return this.clients.some((client) => client.username === username);
  }

  handleMessage(client, message) {
    const [command, ...args] = message.split(" ");

    switch (command) {
      case "/join":
        this.handleJoin(client, args[0]);
        break;
      case "/leave":
        this.handleLeave(client);
        break;
      case "/pm":
        this.handlePrivateMessage(client, args[0], args.slice(1).join(" "));
        break;
      case "/reply":
      case "/r":
        this.handleReply(client, args.join(" "));
        break;
      case "/react":
        this.handleReaction(client, args[0]);
        break;
      case "/channels":
        this.handleChannels(client);
        break;
      case "/quit":
        this.handleQuit(client);
        break;
      default:
        this.handleChannelMessage(client, message);
        break;
    }
  }

  handleJoin(client, channelName) {
    if (client.channel) {
      client.socket.write(
        `You are already in the ${client.channel} channel.\n`
      );
      return;
    }

    if (!this.channels[channelName]) {
      this.channels[channelName] = [];
    }

    client.channel = channelName;
    this.channels[channelName].push(client);

    client.socket.write(`You joined the channel: ${channelName}\n`);
    client.socket.write(
      `To leave the channel, use the command: /leave ${channelName}\n`
    );

    console.log(`User ${client.username} joined the ${channelName} channel`);
  }

  handleLeave(client) {
    if (!client.channel) {
      client.socket.write("You are not in any channel.\n");
      return;
    }

    const channelClients = this.channels[client.channel];
    const index = channelClients.indexOf(client);
    if (index !== -1) {
      channelClients.splice(index, 1);
    }

    client.socket.write(`You left the channel: ${client.channel}\n`);
    client.socket.write("Enter a command: ");

    console.log(`User ${client.username} left the ${client.channel} channel`);
    client.channel = null;
  }

  handlePrivateMessage(sender, recipient, message) {
    const recipientClient = this.clients.find(
      (client) => client.username === recipient
    );

    if (!recipientClient) {
      sender.socket.write(`User '${recipient}' not found.\n`);
      return;
    }

    recipientClient.socket.write(`(private) ${sender.username}: ${message}\n`);
    sender.socket.write(`(private) to ${recipient}: ${message}\n`);

    recipientClient.lastMessageSender = sender.username;
    recipientClient.socket.write("Enter a command: ");

    console.log(
      `User ${sender.username} sent a private message to ${recipient}`
    );
  }

  handleChannelMessage(client, message) {
    if (!client.channel) {
      client.socket.write(
        "You are not in any channel. Join a channel first.\n"
      );
      return;
    }

    const channelClients = this.channels[client.channel];

    // Extract the mentioned usernames from the message
    const mentionedUsernames = message.match(/@(\w+)/g);
    if (mentionedUsernames) {
      mentionedUsernames.forEach((mentionedUsername) => {
        const mentionedClient = channelClients.find(
          (c) => c.username === mentionedUsername.substring(1)
        );
        if (mentionedClient) {
          mentionedClient.socket.write(
            `[MENTION] ${client.username}: ${message}\n`
          );
        }
      });
    }

    // Broadcast the message to all clients in the channel
    channelClients.forEach((channelClient) => {
      channelClient.socket.write(
        `${client.channel}: ${client.username}: ${message}\n`
      );
    });

    client.lastMessage = message;

    console.log(
      `User ${client.username} sent a message to the ${client.channel} channel`
    );
  }

  handleDisconnect(client) {
    if (client.username) {
      console.log(`User ${client.username} disconnected`);
      this.removeClient(client);
    }
  }

  removeClient(client) {
    this.clients = this.clients.filter((c) => c !== client);

    if (client.channel) {
      const channelClients = this.channels[client.channel];
      const index = channelClients.indexOf(client);
      if (index !== -1) {
        channelClients.splice(index, 1);
      }
    }
  }

  handleChannels(client) {
    const channelNames = Object.keys(this.channels);

    if (channelNames.length === 0) {
      client.socket.write("No channels available.\n");
    } else {
      client.socket.write("Available channels:\n");
      channelNames.forEach((channelName) => {
        client.socket.write(`- ${channelName}\n`);
      });
    }

    client.socket.write("Enter a command: ");
  }
}

const server = new Server(PORT); // Default port
server.start();
