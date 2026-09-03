<?php

namespace SilverStripe\Taxonomy;

use SilverStripe\ORM\DataObject;

class TaxonomyTerm extends DataObject
{
    private static $table_name = 'TaxonomyTerm';

    private static $db = array(
        'Name' => 'Varchar(255)',
        'Description' => 'Text',
    );

    private static $has_one = [
        'Type' => TaxonomyType::class,
    ];
}
