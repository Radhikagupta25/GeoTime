
const TOKEN_URL =
    "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";

export async function getSentinelHubToken() {
    const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
    const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("Sentinel Hub credentials are missing from backend/.env");
    }

    const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
    });

    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
    });

    if (!response.ok) {
        console.error("Sentinel Hub authentication failed:", response.status);
        throw new Error(`Sentinel Hub authentication failed (${response.status})`);
    }

    const data = await response.json();

    if (!data.access_token) {
        throw new Error("Sentinel Hub did not return an access token");
    }

    return data.access_token;
}
