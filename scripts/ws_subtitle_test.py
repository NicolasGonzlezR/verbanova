import asyncio
import base64
import json
import os
import sys

import websockets

async def send_test(uri: str, file_seed: int = 0):
    async with websockets.connect(uri) as ws:
        print('connected')
        # send process message
        config = {"input_lang": "English", "target_lang": "Spanish", "whisper_model_size": "small"}
        await ws.send(json.dumps({"type": "process", "config": config}))
        print('sent process')
        # send 4 fake audio_chunk messages (small payload)
        sample = (b"\x00\x00" * 10000)  # 40KB-ish
        b64 = base64.b64encode(sample).decode('utf-8')
        for i in range(4):
            await ws.send(json.dumps({"type": "audio_chunk", "data": b64}))
            print(f'sent chunk {i+1}')
            await asyncio.sleep(0.01)
        await ws.send(json.dumps({"type": "audio_end"}))
        print('sent audio_end')

        try:
            async for msg in ws:
                print('recv:', msg)
        except websockets.exceptions.ConnectionClosed as e:
            print('connection closed', e)

if __name__ == '__main__':
    uri = os.environ.get('TEST_WS_URI', 'ws://localhost:8000/ws/subtitle')
    asyncio.run(send_test(uri))
