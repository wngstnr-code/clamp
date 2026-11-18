/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/clamp.json`.
 */
export type Clamp = {
  "address": "wXKbfiz8yqTgGksXC5ZpN77CzXgW77ttcqHxnpqMrhC",
  "metadata": {
    "name": "clamp",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Clamp: two-way GPU rental price lock (index, series, pool, vault, locks)"
  },
  "instructions": [
    {
      "name": "initIndex",
      "docs": [
        "Creates the index of a class and binds its observation ring. Admin only."
      ],
      "discriminator": [
        206,
        236,
        58,
        58,
        171,
        221,
        237,
        57
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "classConfig"
        },
        {
          "name": "indexState",
          "writable": true
        },
        {
          "name": "observations",
          "docs": [
            "Fresh account of `Observations::SIZE` bytes owned by this program and",
            "still all zero (`zero` checks both and writes the discriminator)."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "classId",
          "type": "u8"
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "Creates the global config. Upgrade authority only, once."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "treasury"
        },
        {
          "name": "program",
          "address": "wXKbfiz8yqTgGksXC5ZpN77CzXgW77ttcqHxnpqMrhC"
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initializeParams"
            }
          }
        }
      ]
    },
    {
      "name": "setClass",
      "docs": [
        "Creates or updates a GPU class. Admin only."
      ],
      "discriminator": [
        88,
        208,
        86,
        138,
        241,
        160,
        255,
        115
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "classConfig",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "classId",
          "type": "u8"
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "classParams"
            }
          }
        }
      ]
    },
    {
      "name": "submitReport",
      "docs": [
        "Stores a reporter's report and updates the index when allowed."
      ],
      "discriminator": [
        27,
        178,
        64,
        9,
        20,
        46,
        250,
        14
      ],
      "accounts": [
        {
          "name": "reporter",
          "signer": true
        },
        {
          "name": "classConfig"
        },
        {
          "name": "indexState",
          "writable": true
        },
        {
          "name": "observations",
          "writable": true,
          "relations": [
            "indexState"
          ]
        }
      ],
      "args": [
        {
          "name": "classId",
          "type": "u8"
        },
        {
          "name": "prices",
          "type": {
            "array": [
              "u64",
              6
            ]
          }
        },
        {
          "name": "capacities",
          "type": {
            "array": [
              "u32",
              6
            ]
          }
        },
        {
          "name": "rawHashes",
          "type": {
            "array": [
              {
                "array": [
                  "u8",
                  32
                ]
              },
              6
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "classConfig",
      "discriminator": [
        12,
        14,
        218,
        247,
        8,
        85,
        10,
        250
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "indexState",
      "discriminator": [
        39,
        84,
        33,
        207,
        234,
        99,
        126,
        210
      ]
    },
    {
      "name": "observations",
      "discriminator": [
        119,
        205,
        13,
        6,
        93,
        29,
        178,
        203
      ]
    }
  ],
  "events": [
    {
      "name": "indexUpdated",
      "discriminator": [
        57,
        221,
        94,
        47,
        121,
        227,
        38,
        114
      ]
    },
    {
      "name": "reportSubmitted",
      "discriminator": [
        30,
        14,
        109,
        53,
        161,
        40,
        129,
        244
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidFeeParams",
      "msg": "Fee or allocation parameter out of range"
    },
    {
      "code": 6001,
      "name": "invalidClassParams",
      "msg": "Class parameter out of range"
    },
    {
      "code": 6002,
      "name": "invalidClassId",
      "msg": "Class id must be 1 or higher"
    },
    {
      "code": 6003,
      "name": "sourcesLocked",
      "msg": "The sources of a class cannot change after it is created"
    },
    {
      "code": 6004,
      "name": "classDisabled",
      "msg": "The class is disabled"
    },
    {
      "code": 6005,
      "name": "notReporter",
      "msg": "The signer is not a registered reporter of this class"
    },
    {
      "code": 6006,
      "name": "invalidReport",
      "msg": "A price was sent for a source slot the class does not use"
    },
    {
      "code": 6007,
      "name": "invalidObservationsAccount",
      "msg": "The observations account has the wrong size"
    },
    {
      "code": 6008,
      "name": "treasuryMintMismatch",
      "msg": "Collateral mint and treasury do not match"
    },
    {
      "code": 6009,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6010,
      "name": "mathInvalidInput",
      "msg": "Invalid input to a math function"
    },
    {
      "code": 6011,
      "name": "missingRawHash",
      "msg": "A price above 0 needs the hash of its raw API answer"
    }
  ],
  "types": [
    {
      "name": "classConfig",
      "docs": [
        "Settings of one GPU class. PDA `[\"class\", class_id]`.",
        "",
        "Reporters, quorum, bounds and widths affect future updates and future",
        "series only. The sources are fixed when the class is created, because the",
        "stored reports are read by source slot."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "classId",
            "docs": [
              "1 = RTX 4090, 2 = H100. 0 means the account was just created."
            ],
            "type": "u8"
          },
          {
            "name": "name",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "reporters",
            "type": {
              "array": [
                "pubkey",
                5
              ]
            }
          },
          {
            "name": "reporterCount",
            "type": "u8"
          },
          {
            "name": "minReporters",
            "type": "u8"
          },
          {
            "name": "sources",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "source"
                  }
                },
                6
              ]
            }
          },
          {
            "name": "sourceCount",
            "type": "u8"
          },
          {
            "name": "minSources",
            "type": "u8"
          },
          {
            "name": "minTotalWeight",
            "type": "u8"
          },
          {
            "name": "minPrice",
            "docs": [
              "Sanity bounds for one reported price, micro-USD per GPU-hour."
            ],
            "type": "u64"
          },
          {
            "name": "maxPrice",
            "type": "u64"
          },
          {
            "name": "maxStepPpm",
            "type": "u32"
          },
          {
            "name": "halfWidthPpm",
            "docs": [
              "Band half width per series kind: daily, weekly, monthly."
            ],
            "type": {
              "array": [
                "u32",
                3
              ]
            }
          },
          {
            "name": "currentSeries",
            "docs": [
              "The latest series per kind (set from M2 on)."
            ],
            "type": {
              "array": [
                "pubkey",
                3
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "classParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "reporters",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "minReporters",
            "type": "u8"
          },
          {
            "name": "sources",
            "docs": [
              "Must equal the stored sources when the class already exists."
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "source"
                }
              }
            }
          },
          {
            "name": "minSources",
            "type": "u8"
          },
          {
            "name": "minTotalWeight",
            "type": "u8"
          },
          {
            "name": "minPrice",
            "type": "u64"
          },
          {
            "name": "maxPrice",
            "type": "u64"
          },
          {
            "name": "maxStepPpm",
            "type": "u32"
          },
          {
            "name": "halfWidthPpm",
            "type": {
              "array": [
                "u32",
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Global settings. PDA `[\"config\"]`.",
        "",
        "The layout is final: it must not change once the account exists on devnet",
        "(architecture 3.1). New fields go into `_reserved`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "docs": [
              "Collateral of every series (tUSDC on devnet)."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "docs": [
              "Token account of `collateral_mint` that receives protocol fees."
            ],
            "type": "pubkey"
          },
          {
            "name": "tradeFeeBps",
            "docs": [
              "Copied into each new series."
            ],
            "type": "u16"
          },
          {
            "name": "protocolShareBps",
            "docs": [
              "Share of each trade fee that goes to the treasury."
            ],
            "type": "u16"
          },
          {
            "name": "seriesAllocBps",
            "docs": [
              "Vault NAV allocated to one series when it is seeded."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "indexState",
      "docs": [
        "Live index of one class. PDA `[\"index\", class_id]`.",
        "",
        "`last_*` and `cum_*` equal the newest observation once `update_count > 0`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "classId",
            "type": "u8"
          },
          {
            "name": "observations",
            "docs": [
              "The `Observations` account bound by `init_index`."
            ],
            "type": "pubkey"
          },
          {
            "name": "lastTs",
            "type": "i64"
          },
          {
            "name": "lastPrice",
            "type": "u64"
          },
          {
            "name": "cumPrice",
            "type": "u128"
          },
          {
            "name": "cumValid",
            "type": "u64"
          },
          {
            "name": "obsIndex",
            "docs": [
              "Ring slot of the newest observation."
            ],
            "type": "u16"
          },
          {
            "name": "obsCount",
            "docs": [
              "Filled ring slots."
            ],
            "type": "u16"
          },
          {
            "name": "updateCount",
            "type": "u64"
          },
          {
            "name": "reports",
            "docs": [
              "Indexed by reporter slot of the class."
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "report"
                  }
                },
                5
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "indexUpdated",
      "docs": [
        "An index update was accepted and recorded (spec 6.2 step 7, 6.3)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "classId",
            "type": "u8"
          },
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "price",
            "docs": [
              "Recorded price after the step limit."
            ],
            "type": "u64"
          },
          {
            "name": "candidate",
            "docs": [
              "Weighted median before the step limit."
            ],
            "type": "u64"
          },
          {
            "name": "reporterCount",
            "docs": [
              "Fresh reports that formed this update."
            ],
            "type": "u8"
          },
          {
            "name": "sources",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "sourceUsed"
                  }
                },
                6
              ]
            }
          },
          {
            "name": "cumPrice",
            "type": "u128"
          },
          {
            "name": "cumValid",
            "type": "u64"
          },
          {
            "name": "updateCount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initializeParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tradeFeeBps",
            "type": "u16"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "seriesAllocBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "observationSlot",
      "docs": [
        "One stored index update. `cum_price` is split into two `u64` halves so the",
        "struct has 8-byte alignment and no padding (zero-copy safe). 40 bytes."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "cumPriceLo",
            "type": "u64"
          },
          {
            "name": "cumPriceHi",
            "type": "u64"
          },
          {
            "name": "cumValid",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "observations",
      "docs": [
        "Ring of index updates of one class (spec 6.3).",
        "",
        "Not a PDA: about 80 KB is more than a program can allocate in one",
        "instruction, so the setup script creates it with a fresh keypair at full",
        "size, owned by this program, and `init_index` binds it to the class."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "items",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "observationSlot"
                  }
                },
                2048
              ]
            }
          }
        ]
      }
    },
    {
      "name": "report",
      "docs": [
        "The latest report of one reporter slot."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "reporter",
            "docs": [
              "Who sent it. A report counts only while this key is still in the slot."
            ],
            "type": "pubkey"
          },
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "used",
            "docs": [
              "Already part of an accepted update."
            ],
            "type": "bool"
          },
          {
            "name": "prices",
            "docs": [
              "By source slot. 0 = the source did not answer."
            ],
            "type": {
              "array": [
                "u64",
                6
              ]
            }
          },
          {
            "name": "capacities",
            "type": {
              "array": [
                "u32",
                6
              ]
            }
          }
        ]
      }
    },
    {
      "name": "reportSubmitted",
      "docs": [
        "A reporter's report was stored (spec 6.2). Carries the raw response hashes."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "classId",
            "type": "u8"
          },
          {
            "name": "reporter",
            "type": "pubkey"
          },
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "prices",
            "docs": [
              "By source slot of the class. 0 = the source did not answer."
            ],
            "type": {
              "array": [
                "u64",
                6
              ]
            }
          },
          {
            "name": "capacities",
            "type": {
              "array": [
                "u32",
                6
              ]
            }
          },
          {
            "name": "rawHashes",
            "docs": [
              "SHA-256 of the archived raw API response, by source slot."
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                6
              ]
            }
          }
        ]
      }
    },
    {
      "name": "source",
      "docs": [
        "One price source of a class, in the order of the report slots."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sourceId",
            "docs": [
              "1 Vast.ai, 2 RunPod, 3 Akash, 4 Nosana."
            ],
            "type": "u8"
          },
          {
            "name": "hasCapacity",
            "docs": [
              "True: weight by capacity tier. False: use `fixed_weight`."
            ],
            "type": "bool"
          },
          {
            "name": "fixedWeight",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "sourceUsed",
      "docs": [
        "One source as it entered an index update."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sourceId",
            "type": "u8"
          },
          {
            "name": "price",
            "docs": [
              "Combined price across reporters. 0 = the source was left out."
            ],
            "type": "u64"
          },
          {
            "name": "capacity",
            "type": "u32"
          },
          {
            "name": "weight",
            "docs": [
              "Weight in the weighted median. 0 = left out."
            ],
            "type": "u8"
          }
        ]
      }
    }
  ]
};
