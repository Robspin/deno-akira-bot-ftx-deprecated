import { hmac } from "https://deno.land/x/hmac@v2.0.1/mod.ts"

type Fractals = {
    downFractals: number[], upFractals: number[]
}

export class FtxClient {
    private readonly apiSecret: string
    config: any

    constructor(apiKey: string, apiSecret: string, subAccount: string) {
        this.config = {
            baseUrl: 'https://ftx.com/api',
            timeout: 5000,
            headers: {
                'accept': 'application/json',
                'Content-Type': 'application/json; utf-8',
                'FTX-KEY': apiKey,
                'FTX-SUBACCOUNT': subAccount
            }
        }
        this.apiSecret = apiSecret
    }

    private makeSignature(method: string, url: string, params?: object) {
        const now = Date.now()
        this.config.headers['FTX-TS'] = now
        let dataQueryString = now + method + '/api' + url
        if (params) dataQueryString += JSON.stringify(params)

        this.config.headers['FTX-SIGN'] = hmac('sha256', this.apiSecret, dataQueryString, 'utf8', 'hex')
    }

    async apiRequest(method: string, url: string, params?: object) {
        this.makeSignature(method, url, params)
        const body = JSON.stringify(params)

        const res = await fetch(`${this.config.baseUrl}${url}`, { method: method, headers: this.config.headers, body })

        return await res.json()
    }

    async hasOpenPosition() {
        const data = await this.apiRequest('GET', '/positions')
        if (data.result.length === 0) return false
        if (data.result[0].size === 0) return false
        return true
    }

    async hasOpenTriggerOrders() {
        const data = await this.apiRequest('GET', '/conditional_orders?market=BTC-PERP')
        if (data.result.length === 0) return false
        return true
    }

    async closeAllOrders() {
        const data = await this.apiRequest('DELETE', '/orders')
        return data
    }

    async getAccountBalance() : Promise<number> {
        const res = await this.apiRequest('GET', '/account')
        return res.result.totalAccountValue.toFixed(2)
    }

    async openPosition(side: 'buy' | 'sell', size: number) {
        const currentFuture = await this.apiRequest('GET', '/futures/BTC-PERP')
        const convertedSize = size / currentFuture.result.last

        const data = {
            'market': 'BTC-PERP',
            'type': 'market',
            'price': null,
            'reduceOnly': false,
            size: convertedSize,
            side
        }

        return await this.apiRequest('POST', '/orders', data)
    }

    async placeStopLoss(fractals: Fractals) {
        const res = await this.apiRequest('GET', '/positions')
        const { size, side } = res.result[0]
        let price
        if (side === 'buy') price = fractals.downFractals[0]
        if (side === 'sell') price = fractals.upFractals[0]
        const data = {
            'market': 'BTC-PERP',
            'triggerPrice': price,
            'reduceOnly': true,
            'type': 'stop',
            side: side === 'buy' ? 'sell' : 'buy',
            size,
        }
        const stopRes = await this.apiRequest('POST', '/conditional_orders', data)
        console.log(`
            Created ${side} stop @${price}
            `)
        console.log(stopRes)
        console.log(data)
        return stopRes
    }

    async cancelAllOrders() {
        return await this.apiRequest('DELETE', '/orders', { 'market': 'BTC-PERP' })
    }

    async checkAndCloseOrders() {
        const hasStopLosses = await this.hasOpenTriggerOrders()
        if (hasStopLosses) await this.closeAllOrders()
    }

    async checkAndMoveStopLoss(fractals: Fractals) {
        const currentStopLoss = await this.apiRequest('GET', '/conditional_orders?market=BTC-PERP')
        if (currentStopLoss.result.length === 0) {
            await this.placeStopLoss(fractals)
            return
        }

        const { side, triggerPrice } = currentStopLoss.result
        const { downFractals, upFractals } = fractals

        if (side === 'buy' && triggerPrice !== downFractals[0] || side === 'sell' && triggerPrice !== upFractals[0]) {
            await this.cancelAllOrders()
            console.log(`
            Canceled existing stops`)
            await this.placeStopLoss(fractals)
        }
    }
}
