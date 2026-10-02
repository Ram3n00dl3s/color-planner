import * as http from 'http';

// Node modules available in Obsidian
const { shell } = require('electron');

export async function authenticateGoogle(clientId: string, clientSecret: string): Promise<{ refreshToken: string; accessToken: string }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer();

        server.on('request', async (req, res) => {
            try {
                if (!req.url) return;
                const address = server.address();
                const port = typeof address === 'object' && address ? address.port : 0;
                const url = new URL(req.url, `http://127.0.0.1:${port}`);

                if (url.pathname === '/oauth2callback') {
                    const code = url.searchParams.get('code');
                    const error = url.searchParams.get('error');

                    if (error) {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end(`<h1>Auth Error</h1><p>${error}</p><p>You can close this window.</p>`);
                        server.close();
                        reject(new Error(error));
                        return;
                    }

                    if (code) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(`<h1>Authentication Successful!</h1><p>You can close this window and return to Obsidian.</p>`);

                        // Exchange code for token
                        const redirectUri = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}/oauth2callback`;

                        try {
                            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                body: new URLSearchParams({
                                    code,
                                    client_id: clientId,
                                    client_secret: clientSecret,
                                    redirect_uri: redirectUri,
                                    grant_type: 'authorization_code'
                                }).toString()
                            });

                            const data = await tokenResponse.json();

                            if (data.error) {
                                reject(new Error(data.error_description || data.error));
                            } else {
                                resolve({
                                    refreshToken: data.refresh_token,
                                    accessToken: data.access_token
                                });
                            }
                        } catch (err) {
                            reject(err);
                        } finally {
                            server.close();
                        }
                    }
                }
            } catch (err) {
                res.writeHead(500);
                res.end('Internal Server Error');
                server.close();
                reject(err);
            }
        });

        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as import('net').AddressInfo).port;
            const redirectUri = encodeURIComponent(`http://127.0.0.1:${port}/oauth2callback`);
            const scope = encodeURIComponent('https://www.googleapis.com/auth/calendar');
            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;

            // Open the user's browser
            shell.openExternal(authUrl);
        });

        // Timeout after 3 minutes
        setTimeout(() => {
            if (server.listening) {
                server.close();
                reject(new Error('Authentication timed out after 3 minutes'));
            }
        }, 3 * 60 * 1000);
    });
}


export async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        }).toString()
    });

    const data = await response.json();
    if (data.error) {
        throw new Error(data.error_description || data.error);
    }
    return data.access_token;
}

export async function fetchCalendarList(accessToken: string): Promise<any[]> {
    const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch calendars: ${response.statusText}`);
    }

    const data = await response.json();
    return data.items || [];
}
