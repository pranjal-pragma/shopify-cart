# Free gift discount Function

This Shopify Function applies a 100% product discount to an eligible gift line.
It validates the configured offer ID, gift variant, gift quantity, and cart
conditions before returning a discount operation.

## Development

```shell
npm install
npm run build
npm test -- --run
```

The app backend creates one scheduled automatic app discount for each enabled
free-gift offer and stores the Function configuration on that discount.
