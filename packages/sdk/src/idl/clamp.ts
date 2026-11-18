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
      "name": "createSeries",
      "docs": [
        "Creates the next series of a class and kind. Anyone, after the previous one expired."
      ],
      "discriminator": [
        181,
        9,
        52,
        120,
        197,
        221,
        42,
        142
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
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
          "name": "indexState"
        },
        {
          "name": "observations",
          "relations": [
            "indexState"
          ]
        },
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "upMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "series"
              }
            ]
          }
        },
        {
          "name": "downMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  111,
                  119,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "series"
              }
            ]
          }
        },
        {
          "name": "collateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "series"
              }
            ]
          }
        },
        {
          "name": "upVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  112,
                  118
                ]
              },
              {
                "kind": "account",
                "path": "series"
              }
            ]
          }
        },
        {
          "name": "downVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  111,
                  119,
                  110,
                  118
                ]
              },
              {
                "kind": "account",
                "path": "series"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
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
          "name": "kind",
          "type": "u8"
        }
      ]
    },
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
      "name": "mergePairs",
      "docs": [
        "Returns `amount` UP and `amount` DOWN, receives `amount` collateral."
      ],
      "discriminator": [
        134,
        107,
        200,
        162,
        165,
        236,
        228,
        108
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "upMint",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "downMint",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "collateral",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "userCollateral",
          "writable": true
        },
        {
          "name": "userUp",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "upMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userDown",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "downMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "mintPairs",
      "docs": [
        "Pays `amount` collateral, receives `amount` UP and `amount` DOWN."
      ],
      "discriminator": [
        63,
        216,
        104,
        77,
        215,
        189,
        83,
        81
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "upMint",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "downMint",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "collateral",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "userCollateral",
          "writable": true
        },
        {
          "name": "userUp",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "upMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userDown",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "downMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "redeem",
      "docs": [
        "Burns settled claims of one side for their value in collateral."
      ],
      "discriminator": [
        184,
        12,
        86,
        149,
        70,
        196,
        97,
        225
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "series"
        },
        {
          "name": "claimMint",
          "docs": [
            "The UP or DOWN mint of the series, matching `side`."
          ],
          "writable": true
        },
        {
          "name": "userClaims",
          "writable": true
        },
        {
          "name": "collateral",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "userCollateral",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "amount",
          "type": "u64"
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
      "name": "settleSeries",
      "docs": [
        "Settles an expired series from the index period average. Anyone."
      ],
      "discriminator": [
        117,
        139,
        23,
        250,
        111,
        55,
        22,
        125
      ],
      "accounts": [
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "indexState"
        },
        {
          "name": "observations",
          "relations": [
            "indexState"
          ]
        }
      ],
      "args": []
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
    },
    {
      "name": "series",
      "discriminator": [
        240,
        97,
        8,
        183,
        139,
        77,
        250,
        162
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
      "name": "pairsMerged",
      "discriminator": [
        71,
        8,
        73,
        137,
        168,
        67,
        61,
        39
      ]
    },
    {
      "name": "pairsMinted",
      "discriminator": [
        108,
        154,
        184,
        215,
        50,
        138,
        35,
        141
      ]
    },
    {
      "name": "redeemed",
      "discriminator": [
        14,
        29,
        183,
        71,
        31,
        165,
        107,
        38
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
    },
    {
      "name": "seriesCreated",
      "discriminator": [
        2,
        164,
        54,
        38,
        24,
        181,
        233,
        180
      ]
    },
    {
      "name": "seriesSettled",
      "discriminator": [
        119,
        185,
        208,
        158,
        40,
        59,
        197,
        235
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
    },
    {
      "code": 6012,
      "name": "invalidKind",
      "msg": "Series kind must be 0 (daily), 1 (weekly) or 2 (monthly)"
    },
    {
      "code": 6013,
      "name": "seriesStillLive",
      "msg": "The current series of this class and kind has not expired yet"
    },
    {
      "code": 6014,
      "name": "indexStale",
      "msg": "The index has no update within MAX_GAP"
    },
    {
      "code": 6015,
      "name": "notEnoughHistory",
      "msg": "Less than 6 hours of index history in the center window"
    },
    {
      "code": 6016,
      "name": "invalidBand",
      "msg": "The band is empty"
    },
    {
      "code": 6017,
      "name": "wrongMint",
      "msg": "Wrong mint for this series"
    },
    {
      "code": 6018,
      "name": "wrongTokenAccount",
      "msg": "Wrong token account for this series"
    },
    {
      "code": 6019,
      "name": "zeroAmount",
      "msg": "Amount must be above 0"
    },
    {
      "code": 6020,
      "name": "seriesSettled",
      "msg": "The series is already settled"
    },
    {
      "code": 6021,
      "name": "notExpired",
      "msg": "The series has not expired yet"
    },
    {
      "code": 6022,
      "name": "notSettled",
      "msg": "The series is not settled yet"
    },
    {
      "code": 6023,
      "name": "invalidSide",
      "msg": "Side must be 0 (UP) or 1 (DOWN)"
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
              "The latest series per kind (set by create_series)."
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
            "name": "currentExpiry",
            "docs": [
              "Expiry of the latest series per kind; 0 = none yet. Taken from the",
              "reserved bytes in M2 (D-056), so existing accounts read 0."
            ],
            "type": {
              "array": [
                "i64",
                3
              ]
            }
          },
          {
            "name": "seriesCount",
            "docs": [
              "Series created so far per kind; the next series uses this number in its",
              "PDA seeds (D-056)."
            ],
            "type": {
              "array": [
                "u32",
                3
              ]
            }
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                28
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
      "name": "pairsMerged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pairsMinted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "redeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
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
      "name": "series",
      "docs": [
        "One series of a class and kind (spec 7). PDA",
        "`[\"series\", class_id, kind, seq (u32 LE)]`, `seq` = the class's",
        "`series_count[kind]` at creation (D-056).",
        "",
        "The layout is final from M2 on (architecture 3.1): the pool and vault",
        "fields are here from the start, so a live weekly series survives the M2",
        "pool work. New fields go into `_reserved`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "classId",
            "type": "u8"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "seq",
            "type": "u32"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "closeTs",
            "type": "i64"
          },
          {
            "name": "expiryTs",
            "type": "i64"
          },
          {
            "name": "center",
            "docs": [
              "Band, micro-USD per GPU-hour."
            ],
            "type": "u64"
          },
          {
            "name": "lower",
            "type": "u64"
          },
          {
            "name": "upper",
            "type": "u64"
          },
          {
            "name": "startIndex",
            "docs": [
              "Index price at creation (used when the period has no counted time)."
            ],
            "type": "u64"
          },
          {
            "name": "startCumPrice",
            "docs": [
              "Running sums of the class index at `start_ts`."
            ],
            "type": "u128"
          },
          {
            "name": "startCumValid",
            "type": "u64"
          },
          {
            "name": "tradeFeeBps",
            "type": "u16"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "upMint",
            "type": "pubkey"
          },
          {
            "name": "downMint",
            "type": "pubkey"
          },
          {
            "name": "collateral",
            "docs": [
              "Collateral token account of the series (owner: the series PDA)."
            ],
            "type": "pubkey"
          },
          {
            "name": "upVault",
            "docs": [
              "Vault-owned UP and DOWN units (pool plus inventory), owner: the series PDA."
            ],
            "type": "pubkey"
          },
          {
            "name": "downVault",
            "type": "pubkey"
          },
          {
            "name": "pairsOutstanding",
            "docs": [
              "Pairs minted and not merged yet, including the vault's."
            ],
            "type": "u64"
          },
          {
            "name": "poolUp",
            "type": "u64"
          },
          {
            "name": "poolDown",
            "type": "u64"
          },
          {
            "name": "invUp",
            "type": "u64"
          },
          {
            "name": "invDown",
            "type": "u64"
          },
          {
            "name": "lastRecenterTs",
            "type": "i64"
          },
          {
            "name": "seeded",
            "type": "bool"
          },
          {
            "name": "settled",
            "type": "bool"
          },
          {
            "name": "avg",
            "docs": [
              "Period average, micro-USD per GPU-hour."
            ],
            "type": "u64"
          },
          {
            "name": "upValue",
            "docs": [
              "Value of one UP claim in micro-USDC (ppm of 1 USDC)."
            ],
            "type": "u32"
          },
          {
            "name": "coveragePpm",
            "docs": [
              "Counted time of the period in ppm of its duration."
            ],
            "type": "u32"
          },
          {
            "name": "settledTs",
            "type": "i64"
          },
          {
            "name": "swept",
            "type": "bool"
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
      "name": "seriesCreated",
      "docs": [
        "A series was created (spec 7.1)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "classId",
            "type": "u8"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "seq",
            "type": "u32"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "closeTs",
            "type": "i64"
          },
          {
            "name": "expiryTs",
            "type": "i64"
          },
          {
            "name": "center",
            "type": "u64"
          },
          {
            "name": "lower",
            "type": "u64"
          },
          {
            "name": "upper",
            "type": "u64"
          },
          {
            "name": "startIndex",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "seriesSettled",
      "docs": [
        "A series was settled (spec 11)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "avg",
            "type": "u64"
          },
          {
            "name": "upValue",
            "type": "u32"
          },
          {
            "name": "coveragePpm",
            "type": "u32"
          },
          {
            "name": "settledTs",
            "type": "i64"
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
