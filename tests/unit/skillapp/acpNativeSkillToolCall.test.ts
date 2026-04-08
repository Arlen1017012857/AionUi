/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IResponseMessage } from '../../../src/common/adapter/ipcBridge';
import { extractNativeSkillLoadFromAcpToolCallMessage } from '../../../src/process/task/AcpAgentManager';

describe('ACP native skill tool call detection', () => {
  it('extracts the skill name from acp tool raw input', () => {
    const message: IResponseMessage = {
      type: 'acp_tool_call',
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
      data: {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-1',
          status: 'in_progress',
          title: 'Skill other',
          kind: 'execute',
          rawInput: {
            skill: 'todo',
          },
        },
      },
    };

    expect(extractNativeSkillLoadFromAcpToolCallMessage(message)).toEqual({
      toolCallId: 'tool-1',
      skillName: 'todo',
    });
  });

  it('falls back to tool output text when raw input is unavailable', () => {
    const message: IResponseMessage = {
      type: 'acp_tool_call',
      msg_id: 'msg-2',
      conversation_id: 'conv-1',
      data: {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-2',
          status: 'completed',
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: 'Launching skill: todo',
              },
            },
          ],
        },
      },
    };

    expect(extractNativeSkillLoadFromAcpToolCallMessage(message)).toEqual({
      toolCallId: 'tool-2',
      skillName: 'todo',
    });
  });

  it('ignores non-skill tool calls', () => {
    const message: IResponseMessage = {
      type: 'acp_tool_call',
      msg_id: 'msg-3',
      conversation_id: 'conv-1',
      data: {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-3',
          status: 'completed',
          title: 'Shell Command',
          kind: 'execute',
          rawInput: {
            command: 'pwd',
          },
        },
      },
    };

    expect(extractNativeSkillLoadFromAcpToolCallMessage(message)).toBeNull();
  });
});
