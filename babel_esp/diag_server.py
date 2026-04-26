import asyncio

async def handler(reader, writer):
    addr = writer.get_extra_info('peername')
    print(f'[+] TCP connection from {addr}', flush=True)
    try:
        data = await asyncio.wait_for(reader.read(4096), timeout=5.0)
        print(f'[+] Received {len(data)} bytes:', flush=True)
        print(repr(data[:500]), flush=True)
    except asyncio.TimeoutError:
        print('[-] No data received within 5s', flush=True)
    writer.close()
    await writer.wait_closed()

async def main():
    srv = await asyncio.start_server(handler, '0.0.0.0', 8765)
    print('Raw TCP listening on 0.0.0.0:8765 ...', flush=True)
    async with srv:
        await srv.serve_forever()

asyncio.run(main())
