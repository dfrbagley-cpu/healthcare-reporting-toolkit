# Reporting Results Checker: five-minute tutorial

The checker answers one narrow question:

> Do these two aggregate result exports contain the complete keys and exact
> integer values required by one versioned synthetic edge case?

It does not run a reporting pipeline, inspect source records, certify a system,
or prove that untested logic is correct.

## 1. Choose a contract

Open the live toolkit, select **Validate**, and choose a synthetic case. The
page shows the case principle, the plausible failure it exposes, and the
expected resolution.

The bundled catalog comes from
[Health Data Edge Cases v0.4.0](https://github.com/dfrbagley-cpu/health-data-edge-cases/releases/tag/v0.4.0).
Its version and SHA-256 digest appear beside the inputs.

## 2. See a failure

Choose **Use deliberate mismatch**, then review the result.

The example changes exactly one expected metric value. The diagnostics identify:

- whether the difference is a metric or quality result;
- its complete key;
- whether it is missing, unexpected, or the wrong value;
- the expected and actual integer values.

The selected case narrative provides a place to investigate. The checker does
not claim that the narrative is the cause of a particular mismatch.

## 3. Correct it

Choose **Use matching example**. The result now passes because every expected
key and value is present and no unexpected key remains.

For your own reporting implementation, export:

`actual_metrics.csv`

```csv
period_id,metric_id,actual_value
```

`actual_quality.csv`

```csv
check_id,actual_value
```

Headers and their order are exact. Keys must be present and unique. Values must
be integer text without decimals, exponents, `NaN`, or infinity.

## 4. Preserve the evidence

Two downloads serve different purposes:

- **Diagnostics CSV** contains exact keys and values. Treat it with the same
  care as the uploaded aggregate outputs.
- **Analysis receipt** contains source-file hashes, catalog provenance, the
  public case ID, and aggregate mismatch counts. It omits filenames, result
  keys, metric and check identifiers, values, and row diagnostics.

A source hash is a linkable fingerprint, not anonymization or proof of when a
file was created.

## 5. Use the result correctly

A pass means only that the uploaded exports match the selected synthetic
contract. Repeat the process for every relevant case and retain your own review
of source data, pipeline logic, local policies, and production controls.
