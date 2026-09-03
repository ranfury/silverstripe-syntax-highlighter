<?php

namespace SilverStripe\Taxonomy;

use SilverStripe\ORM\DataObject;

class TaxonomyType extends DataObject
{
    private static $db = [
        'Name' => 'Varchar(255)',
    ];
}
