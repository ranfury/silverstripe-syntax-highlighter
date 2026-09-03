<?php

namespace SilverStripe\ORM;

class DataObject
{
    private static $fixed_fields = [
        'ID' => 'PrimaryKey',
        'ClassName' => 'DBClassName',
        'LastEdited' => 'DBDatetime',
        'Created' => 'DBDatetime',
    ];
}
