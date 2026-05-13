import { CommandAction } from '@logitech/plugin-sdk';
import { exec } from 'child_process';

function sendMessage(message: string) {
  exec(`start cmd.exe /K echo ${message}`);
}

export class HelloWorldAction extends CommandAction {
  name = 'hello_world_action';
  displayName = 'Hello world';
  description = 'Opens a command prompt with a "Hello world" message';

  async onKeyDown() {
    sendMessage(`Hello world!`);
  }
}
